import { ConsoleUtil } from '../util/console-util';
import { OrgFormationError } from '../org-formation-error';
import { GenericTaskRunner, ITaskRunnerDelegates } from '~core/generic-task-runner';
import { IGenericTask } from '~plugin/plugin-binder';

export class DefaultTaskRunner {

    public static async RunTasks(tasks: IGenericTask[], logicalName: string, maxConcurrentTasks: number, failedTasksTolerance: number): Promise<void> {

        const delegate: ITaskRunnerDelegates<IGenericTask> = {
            onTaskRanFailed: (task, err) => {
                ConsoleUtil.LogError(`failed executing task ${task.logicalName} in account ${task.accountId} (${task.region}). Reason: ${err}`);
            },
            onTaskSkippedBecauseDependencyFailed: task => {
                ConsoleUtil.LogError(`skip executing task ${task.logicalName} in account ${task.accountId} (${task.region}). Reason: dependency has failed.`);
            },
            onTaskRanSuccessfully: task => {
                ConsoleUtil.LogInfo(`stack ${task.logicalName} successfully ${task.action === 'Delete' ? 'deleted from' : 'updated in' } ${task.accountId}/${task.region}.`);
            },
            throwCircularDependency: ts => {
                const targets = ts.map(x => x.accountId + (x.region ? '/' + x.region : ''));
                throw new OrgFormationError(`circular dependency on stack ${logicalName} for targets ${targets.join(', ')}`);
             },
            throwDependencyOnSelfException: task => {throw new OrgFormationError(`stack ${task.logicalName} has dependency on self target account ${task.accountId} / ${task.region}`); },
            onFailureToleranceExceeded: (totalTasksFailed: number, tolerance: number) => {
                throw new OrgFormationError(`number failed tasks ${totalTasksFailed} exceeded tolerance for failed tasks ${tolerance}`);
            },
            maxConcurrentTasks,
            failedTasksTolerance,
        };
        await GenericTaskRunner.RunTasks<IGenericTask>(tasks, delegate);
    }

}
