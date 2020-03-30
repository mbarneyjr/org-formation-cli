import path from 'path';
import { IOrganizationBinding } from "~parser/parser";
import { IBuildTaskConfiguration } from "~build-tasks/build-configuration";
import { IPluginTask, IPluginBinding } from "~plugin/plugin-binder";
import { IBuildTaskPluginCommandArgs, IBuildTaskPlugin } from "../plugin";
import { IPerformTasksCommandArgs } from "~commands/index";
import { existsSync } from 'fs';
import { ChildProcessUtility } from '~core/child-process-util';
import { OrgFormationError } from '../../../src/org-formation-error';
import { Validator } from '~parser/validator';
import { ConsoleUtil } from '../../util/console-util';
import { Md5Util } from '~util/md5-util';

export class SlsBuildTaskPlugin implements IBuildTaskPlugin<IServerlessComTaskConfig, ISlsCommandArgs, ISlsTask> {
    type: string = 'serverless.com';
    typeForTask: string = 'update-serverless.com';

    convertToCommandArgs(config: IServerlessComTaskConfig, command: IPerformTasksCommandArgs): ISlsCommandArgs {

        if (!config.Path) {
            throw new OrgFormationError(`task ${config.LogicalName} does not have required attribute Path`);
        }

        const dir = path.dirname(config.FilePath);
        const cdkPath = path.join(dir, config.Path);

        return {
            ...command,
            name: config.LogicalName,
            runNpmInstall: config.RunNpmInstall === true,
            path: cdkPath,
            failedTolerance: config.FailedTaskTolerance,
            maxConcurrent: config.MaxConcurrentTasks,
            organizationBinding: config.OrganizationBinding,
            taskRoleName: config.TaskRoleName,
        }
    }
    validateCommandArgs(commandArgs: ISlsCommandArgs): void {
        if (!commandArgs.organizationBinding) {
            throw new OrgFormationError(`task ${commandArgs.name} does not have required attribute OrganizationBinding`);
        }

        if (!existsSync(commandArgs.path)) {
            throw new OrgFormationError(`task ${commandArgs.name} cannot find path ${commandArgs.path}`);
        }

        const serverlessFileName = commandArgs.configFile ? commandArgs.configFile : 'serverless.yml';
        const serverlessPath = path.join(commandArgs.path, serverlessFileName);

        if (!existsSync(serverlessPath)) {
            throw new OrgFormationError(`task ${commandArgs.name} cannot find serverless configuration file ${serverlessPath}`);
        }

        if (commandArgs.runNpmInstall) {
            const packageFilePath = path.join(commandArgs.path, 'package.json');
            if (!existsSync(packageFilePath)) {
                throw new OrgFormationError(`task ${commandArgs.name} specifies 'RunNpmInstall' but cannot find npm package file ${packageFilePath}`);
            }

            const packageLockFilePath = path.join(commandArgs.path, 'package-lock.json');
            if (!existsSync(packageLockFilePath)) {
                ConsoleUtil.LogWarning(`task ${commandArgs.name} specifies 'RunNpmInstall' but cannot find npm package file ${packageLockFilePath}. Will perform 'npm i' as opposed to 'npm ci'.`);
            }
        }
        Validator.ValidateOrganizationBinding(commandArgs.organizationBinding, commandArgs.name);
    }

    getValuesForEquality(command: ISlsCommandArgs): any {
        const hashOfServerlessDirectory = Md5Util.Md5OfPath(command.path);
        return {
            runNpmInstall: command.runNpmInstall,
            configFile: command.configFile,
            stage: command.stage,
            path: hashOfServerlessDirectory
        };
    }

    concertToTask(command: ISlsCommandArgs, hashOfTask: string): ISlsTask {
        return {
            type: this.type,
            stage: command.stage,
            configFile: command.configFile,
            name: command.name,
            path: command.path,
            hash: hashOfTask,
            runNpmInstall: command.runNpmInstall,
            taskRoleName: command.taskRoleName,
        };
    }
    async performDelete(binding: IPluginBinding<ISlsTask>): Promise<void> {
        const { task, target } = binding;
        let command = 'npx sls remove';

        const pacakgeLockExists = existsSync(path.resolve(task.path, 'package-lock.json'));
        if (binding.task.runNpmInstall && pacakgeLockExists) {
            command = 'npm ci && ' + command;
        } else {
            command = 'npm i && ' + command;
        }

        command = appendArgumentIfTruthy(command, '--stage', task.stage);
        command = appendArgumentIfTruthy(command, '--region', target.region);
        command = appendArgumentIfTruthy(command, '--config', task.configFile);
        command = command + ' --conceal';
        const accountId = target.accountId;
        const cwd = path.resolve(task.path);

        await ChildProcessUtility.SpawnProcessForAccount(cwd, command, accountId, task.taskRoleName);
    }

    async performCreateOrUpdate(binding: IPluginBinding<ISlsTask>): Promise<void> {
        const { task, target } = binding;
        let command = 'npx sls deploy';

        const hasPackageLock = existsSync(path.resolve(task.path, 'package-lock.json'));
        if (binding.task.runNpmInstall && hasPackageLock) {
            command = 'npm ci && ' + command;
        } else {
            command = 'npm i && ' + command;
        }

        command = appendArgumentIfTruthy(command, '--stage', task.stage);
        command = appendArgumentIfTruthy(command, '--region', target.region);
        command = appendArgumentIfTruthy(command, '--config', task.configFile);
        command = command + ' --conceal';

        const accountId = target.accountId;
        const cwd = path.resolve(task.path);

        await ChildProcessUtility.SpawnProcessForAccount(cwd, command, accountId, task.taskRoleName);
    }
}

const appendArgumentIfTruthy = (command: string, option: string, val?: string): string => {
    if (!val) {return command;}
    return `${command} ${option} ${val}`;
};



export interface IServerlessComTaskConfig extends IBuildTaskConfiguration {
    Path: string;
    Config?: string;
    Stage?: string;
    OrganizationBinding: IOrganizationBinding;
    MaxConcurrentTasks?: number;
    FailedTaskTolerance?: number;
    RunNpmInstall?: boolean;
}

export interface ISlsCommandArgs extends IBuildTaskPluginCommandArgs {
    stage?: string;
    path: string;
    configFile?: string;
    runNpmInstall: boolean;
}

export interface ISlsTask extends IPluginTask {
    path: string;
    stage?: string;
    configFile?: string;
    runNpmInstall: boolean;
}
