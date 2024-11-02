#!/usr/bin/env node
import { Command } from 'commander';
import { AnalyzeCommand } from './cli/commands/analyze.command';

const program = new Command();

program.name('nestjs-dependency-analyzer').description('NestJS project structure analyzer').version('1.0.0');

program.addCommand(new AnalyzeCommand());

program.parse();
