#!/usr/bin/env node

import { generateTemplate, updateTemplate } from './index';

const program = require('commander');

program
  .version('0.0.1')
  .description('aws organization formation');

program
  .command('generate-template <outFile>')
  .option('--profile <profile>', 'aws profile')
  .option('--state-bucket-name <state-bucket-name>', 'bucket name that contains state file')
  .option('--state-object <state-object>', 'key for object used to store state')
  .description('generate template')
  .action(async (outFile, cmd) => await generateTemplate(outFile, cmd));

program
  .command('update-template <templateFile>')
  .option('--profile <profile>', 'aws profile')
  .option('--state-bucket-name <state-bucket-name>', 'bucket name that contains state file')
  .option('--state-object <state-object>', 'key for object used to store state')
  .description('update organization')
  .action(async (templateFile, cmd) => await updateTemplate(templateFile, cmd));

let args = process.argv;
if (args.length === 2) {
  args = args.concat('--help');
}

program.parse(args);
