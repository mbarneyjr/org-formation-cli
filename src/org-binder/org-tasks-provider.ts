import { AwsOrganizationWriter } from '../aws-provider/aws-organization-writer';
import { AccountResource } from '../parser/model/account-resource';
import { OrganizationRootResource } from '../parser/model/organization-root-resource';
import { OrganizationalUnitResource } from '../parser/model/organizational-unit-resource';
import { Reference, Resource } from '../parser/model/resource';
import { OrgResourceTypes } from '../parser/model/resource-types';
import { ServiceControlPolicyResource } from '../parser/model/service-control-policy-resource';
import { TemplateRoot } from '../parser/parser';
import { IBinding, PersistedState } from '../state/persisted-state';

export class TaskProvider {
    private state: PersistedState;
    private previousTemplate: TemplateRoot;
    private writer: AwsOrganizationWriter;

    constructor(currentTemplate: TemplateRoot, persistedState: PersistedState, writer: AwsOrganizationWriter) {
        this.writer = writer;
        this.state = persistedState;
        const previousTemplate = persistedState.getPreviousTemplate();
        if (previousTemplate) {
            this.previousTemplate = TemplateRoot.createFromContents(previousTemplate, currentTemplate.dirname);
        } else {
            this.previousTemplate = TemplateRoot.createEmpty();
        }
    }

    public createRootCreateTasks(resource: OrganizationRootResource, hash: string): IBuildTask[] {
        const that = this;
        const tasks: IBuildTask[] = [];
        const createOrganizationRootTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'Create',
            perform: async (task) => {
                task.result = await that.writer.ensureRoot();
            },
        };

        tasks.push(createOrganizationRootTask);

        for (const attachedSCP of resource.serviceControlPolicies) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, attachedSCP, that, () => createOrganizationRootTask.result);
            attachSCPTask.dependentTasks = [createOrganizationRootTask];
            tasks.push(attachSCPTask);
        }

        const createOrganizationRootCommitHashTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'CommitHash',
            dependentTasks: tasks,
            perform: async (task) => {
                that.state.setBinding({
                    type: resource.type,
                    logicalId: resource.logicalId,
                    lastCommittedHash: hash,
                    physicalId: createOrganizationRootTask.result,
                });
            },
        };

        return [...tasks, createOrganizationRootCommitHashTask];
    }

    public createRootUpdateTasks(resource: OrganizationRootResource, physicalId: string, hash: string): IBuildTask[] {
        const that = this;
        const tasks: IBuildTask[] = [];
        const previousResource = this.previousTemplate.organizationSection.organizationRoot;

        const previousSCPs = this.resolveIDs(previousResource.serviceControlPolicies);
        const currentSCPS = this.resolveIDs(resource.serviceControlPolicies);
        for (const attachedSCP of currentSCPS.physicalIds.filter((x) => !previousSCPs.physicalIds.includes(x))) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, { PhysicalId: attachedSCP }, that, () => physicalId);
            tasks.push(attachSCPTask);
        }
        for (const attachedSCP of currentSCPS.unresolvedResources) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, { TemplateResource: attachedSCP as ServiceControlPolicyResource }, that, () => physicalId);
            tasks.push(attachSCPTask);
        }
        for (const detachedSCP of previousSCPs.physicalIds.filter((x) => !currentSCPS.physicalIds.includes(x))) {
            const detachSCPTask: IBuildTask = this.createDetachSCPTask(resource, detachedSCP, that, physicalId);
            tasks.push(detachSCPTask);
        }

        const createOrganizationalUnitCommitHashTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'CommitHash',
            dependentTasks: tasks,
            perform: async (task) => {
                that.state.setBinding({
                    type: resource.type,
                    logicalId: resource.logicalId,
                    lastCommittedHash: hash,
                    physicalId,
                });
            },
        };

        return [...tasks, createOrganizationalUnitCommitHashTask];
    }

    public createPolicyCreateTasks(resource: ServiceControlPolicyResource, hash: string): IBuildTask[] {
        const that = this;
        return [{
            type: resource.type,
            logicalId: resource.logicalId,
            action: 'Create',
            perform: async () => {
                const physicalId = await that.writer.createPolicy(resource);
                that.state.setBinding({
                    type: resource.type,
                    logicalId: resource.logicalId,
                    lastCommittedHash: hash,
                    physicalId,
                });
            },
        }];
    }

    public createPolicyUpdateTasks(resource: ServiceControlPolicyResource, physicalId: string, hash: string): IBuildTask[] {
        const that = this;
        return [{
            type: resource.type,
            logicalId: resource.logicalId,
            action: 'Update',
            perform: async () => {
                await that.writer.updatePolicy(resource, physicalId);
                that.state.setBinding({
                        type: resource.type,
                        logicalId: resource.logicalId,
                        lastCommittedHash: hash,
                        physicalId,
                    });
            },
        }];
    }

    public createPolicyDeleteTasks(binding: IBinding): IBuildTask[] {
        const that = this;
        return [{
            type: binding.type,
            logicalId: binding.logicalId,
            action: 'Delete',
            perform: async () => {
                await that.writer.deletePolicy(binding.physicalId);
                this.state.removeBinding(binding);
            },
        }];
    }

    public createOrganizationalUnitCreateTasks(resource: OrganizationalUnitResource, hash: string): IBuildTask[] {
        const that = this;
        const tasks: IBuildTask[] = [];
        const createOrganizationalUnitTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'Create',
            perform: async (task) => {
                task.result = await that.writer.createOrganizationalUnit(resource);
            },
        };

        tasks.push(createOrganizationalUnitTask);

        for (const attachedSCP of resource.serviceControlPolicies) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, attachedSCP, that, () => createOrganizationalUnitTask.result);
            attachSCPTask.dependentTasks = [createOrganizationalUnitTask];
            tasks.push(attachSCPTask);
        }

        for (const attachedAccount of resource.accounts) {
            const attachAccountTask: IBuildTask = {
                type: resource.type,
                logicalId: resource.logicalId,
                action:  'Relate',
                dependentTasks: [createOrganizationalUnitTask],
                perform: async (task) => {
                    let accountId = attachedAccount.PhysicalId;
                    if (accountId === undefined) {
                        const binding  = that.state.getBinding(OrgResourceTypes.Account, attachedAccount.TemplateResource.logicalId);
                        accountId = binding.physicalId;
                    }
                    task.result = await that.writer.attachAccount(createOrganizationalUnitTask.result, accountId);
                },
            };
            if (attachedAccount.TemplateResource && undefined === that.state.getBinding(OrgResourceTypes.Account, attachedAccount.TemplateResource.logicalId)) {
                attachAccountTask.dependentTaskFilter = (task) => task.logicalId === attachedAccount.TemplateResource.logicalId &&
                                                            task.action === 'Create' &&
                                                            task.type === OrgResourceTypes.Account;
            }
            tasks.push(attachAccountTask);
        }

        const createOrganizationalUnitCommitHashTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'CommitHash',
            dependentTasks: tasks,
            perform: async (task) => {
                that.state.setBinding({
                    type: resource.type,
                    logicalId: resource.logicalId,
                    lastCommittedHash: hash,
                    physicalId: createOrganizationalUnitTask.result,
                });
            },
        };

        return [...tasks, createOrganizationalUnitCommitHashTask];
    }

    public createOrganizationalUnitUpdateTasks(resource: OrganizationalUnitResource, physicalId: string,  hash: string): IBuildTask[] {
        const that = this;
        const tasks: IBuildTask[] = [];
        const previousResource = this.previousTemplate.organizationSection.organizationalUnits.find((x) => x.logicalId === resource.logicalId);

        if (previousResource === undefined || previousResource.organizationalUnitName !== resource.organizationalUnitName) {
            const updateOrganizationalUnitTask: IBuildTask = {
                type: resource.type,
                logicalId: resource.logicalId,
                action:  'Update',
                perform: async (task) => {
                    task.result = await that.writer.updateOrganizationalUnit(resource, physicalId);
                },
            };

            tasks.push(updateOrganizationalUnitTask);
        }

        const previousSCPs = this.resolveIDs(previousResource.serviceControlPolicies);
        const currentSCPS = this.resolveIDs(resource.serviceControlPolicies);
        for (const attachedSCP of currentSCPS.physicalIds.filter((x) => !previousSCPs.physicalIds.includes(x))) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, { PhysicalId: attachedSCP }, that, () => physicalId);
            tasks.push(attachSCPTask);
        }
        for (const attachedSCP of currentSCPS.unresolvedResources) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, { TemplateResource: attachedSCP as ServiceControlPolicyResource }, that, () => physicalId);
            tasks.push(attachSCPTask);
        }
        for (const detachedSCP of previousSCPs.physicalIds.filter((x) => !currentSCPS.physicalIds.includes(x))) {
            const detachSCPTask: IBuildTask = this.createDetachSCPTask(resource, detachedSCP, that, physicalId);
            tasks.push(detachSCPTask);
        }

        const previousAccounts = this.resolveIDs(previousResource.accounts);
        const currentAccounts = this.resolveIDs(resource.accounts);
        for (const attachAccount of currentAccounts.physicalIds.filter((x) => !previousAccounts.physicalIds.includes(x))) {
            const attachAccountTask: IBuildTask = this.createAttachAccountTask(resource, { PhysicalId: attachAccount }, that, () => physicalId);
            tasks.push(attachAccountTask);
        }
        for (const attachAccount of currentAccounts.unresolvedResources) {
            const attachAccountTask: IBuildTask = this.createAttachAccountTask(resource, { TemplateResource: attachAccount as AccountResource }, that, () => physicalId);
            tasks.push(attachAccountTask);
        }

        const createOrganizationalUnitCommitHashTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'CommitHash',
            dependentTasks: tasks,
            perform: async (task) => {
                that.state.setBinding({
                    type: resource.type,
                    logicalId: resource.logicalId,
                    lastCommittedHash: hash,
                    physicalId,
                });
            },
        };

        return [...tasks, createOrganizationalUnitCommitHashTask];
    }

    public createOrganizationalUnitDeleteTasks(binding: IBinding): IBuildTask[] {
        const that = this;
        return [{
            type: binding.type,
            logicalId: binding.logicalId,
            action: 'Delete',
            perform: async () => {
                await that.writer.deleteOrganizationalUnit(binding.physicalId);
                this.state.removeBinding(binding);
            },
        }];
    }

    public createAccountUpdateTasks(resource: AccountResource, physicalId: string, hash: string): IBuildTask[] {
        const that = this;
        const tasks: IBuildTask[] = [];
        const previousResource = this.previousTemplate.organizationSection.accounts.find((x) => x.logicalId === resource.logicalId);

        if (previousResource === undefined || previousResource.accountName !== resource.accountName || JSON.stringify(previousResource.tags) !== JSON.stringify(resource.tags)) {
            const updateAccountTask: IBuildTask = {
                type: resource.type,
                logicalId: resource.logicalId,
                action:  'Update',
                perform: async (task) => {
                    task.result = await that.writer.updateAccount(resource, physicalId);
                },
            };

            tasks.push(updateAccountTask);
        }

        const previousSCPs = this.resolveIDs(previousResource.serviceControlPolicies);
        const currentSCPS = this.resolveIDs(resource.serviceControlPolicies);
        for (const attachedSCP of currentSCPS.physicalIds.filter((x) => !previousSCPs.physicalIds.includes(x))) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, { PhysicalId: attachedSCP }, that, () => physicalId);
            tasks.push(attachSCPTask);
        }
        for (const attachedSCP of currentSCPS.unresolvedResources) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, { TemplateResource: attachedSCP as ServiceControlPolicyResource }, that, () => physicalId);
            tasks.push(attachSCPTask);
        }
        for (const detachedSCP of previousSCPs.physicalIds.filter((x) => !currentSCPS.physicalIds.includes(x))) {
            const detachSCPTask: IBuildTask = this.createDetachSCPTask(resource, detachedSCP, that, physicalId);
            tasks.push(detachSCPTask);
        }
        const createAccountCommitHashTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'CommitHash',
            dependentTasks: tasks,
            perform: async (task) => {
                that.state.setBinding({
                    type: resource.type,
                    logicalId: resource.logicalId,
                    lastCommittedHash: hash,
                    physicalId,
                });
            },
        };

        return [...tasks, createAccountCommitHashTask];
    }

    public createAccountCreateTasks(resource: AccountResource, hash: string): IBuildTask[] {
        const that = this;
        const tasks: IBuildTask[] = [];
        const createAccountTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'Create',
            perform: async (task) => {
                task.result = await that.writer.createAccount(resource);
            },
        };

        tasks.push(createAccountTask);

        for (const attachedSCP of resource.serviceControlPolicies) {
            const attachSCPTask: IBuildTask = this.createAttachSCPTask(resource, attachedSCP, that, () => createAccountTask.result);
            attachSCPTask.dependentTasks = [createAccountTask];
            tasks.push(attachSCPTask);
        }

        const createAccountCommitHashTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action:  'CommitHash',
            dependentTasks: tasks,
            perform: async (task) => {
                that.state.setBinding({
                    type: resource.type,
                    logicalId: resource.logicalId,
                    lastCommittedHash: hash,
                    physicalId: createAccountTask.result,
                });
            },
        };
        return [...tasks, createAccountCommitHashTask];
    }
    public createForgetResourceTasks(binding: IBinding): IBuildTask[] {
        const that = this;
        return [{
            type: binding.type,
            logicalId: binding.logicalId,
            action: 'Forget',
            perform: async () => {
                this.state.removeBinding(binding);
            },
        }];
    }
    private createDetachSCPTask(resource: OrganizationalUnitResource | AccountResource | OrganizationRootResource, physicalId: string, that: this, targetId: string): IBuildTask {
        return {
            type: resource.type,
            logicalId: resource.logicalId,
            action: 'Relate',
            perform: async (task) => {
                task.result = await that.writer.detachPolicy(targetId, physicalId);
            },
        };
    }

    private createAttachSCPTask(resource: Resource, policy: Reference<ServiceControlPolicyResource>, that: this, getTargetId: () => string) {
        const attachSCPTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action: 'Relate',
            perform: async (task) => {
                let policyId = policy.PhysicalId;
                if (policyId === undefined) {
                    const binding = that.state.getBinding(OrgResourceTypes.ServiceControlPolicy, policy.TemplateResource.logicalId);
                    policyId = binding.physicalId;
                }
                const targetId = getTargetId();
                task.result = await that.writer.attachPolicy(targetId, policyId);
            },
        };
        if (policy.TemplateResource && undefined === that.state.getBinding(OrgResourceTypes.ServiceControlPolicy, policy.TemplateResource.logicalId)) {
            attachSCPTask.dependentTaskFilter = (task) => task.logicalId === policy.TemplateResource.logicalId &&
                task.action === 'Create' &&
                task.type === OrgResourceTypes.ServiceControlPolicy;
        }
        return attachSCPTask;
    }

    private createAttachAccountTask(resource: OrganizationalUnitResource, account: Reference<AccountResource>, that: this, getTargetId: () => string) {
        const attachAccountTask: IBuildTask = {
            type: resource.type,
            logicalId: resource.logicalId,
            action: 'Relate',
            perform: async (task) => {
                let accountId = account.PhysicalId;
                if (accountId === undefined) {
                    const binding = that.state.getBinding(OrgResourceTypes.Account, account.TemplateResource.logicalId);
                    accountId = binding.physicalId;
                }
                const targetId = getTargetId();
                task.result = await that.writer.attachAccount(targetId, accountId);
            },
        };
        if (account.TemplateResource && undefined === that.state.getBinding(OrgResourceTypes.Account, account.TemplateResource.logicalId)) {
            attachAccountTask.dependentTaskFilter = (task) => task.logicalId === account.TemplateResource.logicalId &&
                task.action === 'Create' &&
                task.type === OrgResourceTypes.Account;
        }
        return attachAccountTask;
    }

    private resolveIDs<TResource extends Resource>(list: Array<Reference<TResource>>) {
        const physicalIdsForServiceControlPolicies = list.filter((x) => x.PhysicalId).map((x) => x.PhysicalId);
        const unresolvedResources: TResource[] = [];
        for (const logicalRef of list.filter((x) => x.TemplateResource).map((x) => x.TemplateResource)) {
            const binding = this.state.getBinding(logicalRef.type, logicalRef.logicalId);
            if (binding === undefined) {
                unresolvedResources.push(logicalRef);
            } else  {
                physicalIdsForServiceControlPolicies.push(binding.physicalId);
            }
        }
        return {physicalIds: physicalIdsForServiceControlPolicies.sort(), unresolvedResources};
    }
}

export interface IBuildTask {
    type: string;
    logicalId: string;
    action: BuildTaskAction;
    result?: any;
    dependentTasks?: IBuildTask[];
    dependentTaskFilter?: (task: IBuildTask) => boolean;
    perform: (task: IBuildTask) => Promise<void>;
}

type BuildTaskAction = 'Create' | 'Update' | 'Delete' | 'Relate' | 'Forget' | 'CommitHash';
