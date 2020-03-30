import { ICommandArgs, BaseCliCommand } from "~commands/index";
import { IBuildTaskPlugin, IBuildTaskPluginCommandArgs } from "~plugin/plugin";
import md5 from "md5";
import { TemplateRoot } from "~parser/parser";
import { PluginBinder, IPluginTask } from "./plugin-binder";
import { ConsoleUtil } from "~util/console-util";
import { DefaultTaskRunner } from "../core/default-task-runner";

export class PluginCliCommand<TCommandArgs extends IBuildTaskPluginCommandArgs, TTask extends IPluginTask> extends BaseCliCommand<TCommandArgs> {

    constructor(private plugin: IBuildTaskPlugin<any, TCommandArgs, TTask>) {
        super();
    }

    public async performCommand(command: TCommandArgs): Promise<void> {
        this.plugin.validateCommandArgs(command);

        const usedInHash = this.plugin.getValuesForEquality(command);
        const allUsedInHash = {
            organizationFileHash: command.organizationFileHash,
            taskRoleName: command.taskRoleName,
            ...usedInHash,
        }
        const hash = md5(JSON.stringify(allUsedInHash));
        const task = this.plugin.concertToTask(command, hash);
        const state = await this.getState(command);
        const template = TemplateRoot.create(command.organizationFile, {}, command.organizationFileHash);
        const binder = new PluginBinder<TTask>(task, state, template, command.organizationBinding, this.plugin);
        const tasks = binder.enumTasks();


        if (tasks.length === 0) {
            ConsoleUtil.LogInfo(`${this.plugin.type} workload ${command.name} already up to date.`);
        } else {
            try {
                await DefaultTaskRunner.RunTasks(tasks, command.name, command.maxConcurrent, command.failedTolerance);
            } finally {
                await state.save();
            }
            ConsoleUtil.LogInfo('done');
        }
    }
}