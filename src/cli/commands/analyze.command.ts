import { Command } from 'commander';
import { DependencyAnalyzer } from '../../analyzers/dependency.analyzer';
import { DotVisualizer } from '../../visualizers/dot.visualizer';
import * as fs from 'fs/promises';
import * as path from 'path';

export class AnalyzeCommand extends Command {
  constructor() {
    super('analyze');
    this.description('Analyze NestJS project dependencies')
      .option('-p, --path <path>', 'Project path', process.cwd())
      .option('-f, --format <format>', 'Output format (json|dot)', 'json')
      .option('-d, --depth <depth>', 'Dependency resolution depth', '2')
      .option('-o, --output <output>', 'Output file path')
      .action(this.execute.bind(this));
  }

  private async execute(options: { path: string; format: string; depth: string; output?: string }) {
    try {
      const analyzer = new DependencyAnalyzer(options.path);
      const modules = await analyzer.analyze();

      switch (options.format.toLowerCase()) {
        case 'dot': {
          const visualizer = new DotVisualizer(modules);
          const output = visualizer.generate();

          if (options.output) {
            // Ensure the output directory exists
            const outputDir = path.dirname(options.output);
            await fs.mkdir(outputDir, { recursive: true });

            // Write the DOT file with proper line endings
            const content = output.replace(/\r\n/g, '\n'); // Normalize line endings
            await fs.writeFile(options.output, content, 'utf8');
            console.log(`DOT file saved to: ${options.output}`);

            // If graphviz is installed, automatically generate the PNG
            try {
              const { execSync } = require('child_process');
              const pngOutput = options.output.replace(/\.dot$/, '.png');
              execSync(`dot -Tpng "${options.output}" -o "${pngOutput}"`);
              console.log(`PNG visualization saved to: ${pngOutput}`);
            } catch (err) {
              console.log('To generate PNG visualization, install Graphviz and run:');
              console.log(`dot -Tpng "${options.output}" -o "${options.output.replace(/\.dot$/, '.png')}"`);
            }
          } else {
            console.log(output);
          }
          break;
        }
        case 'json':
        default: {
          const output = JSON.stringify(Array.from(modules.entries()), null, 2);
          if (options.output) {
            await fs.writeFile(options.output, output, 'utf8');
            console.log(`JSON saved to: ${options.output}`);
          } else {
            console.log(output);
          }
          break;
        }
      }
    } catch (error) {
      console.error('Analysis failed:', error);
      process.exit(1);
    }
  }
}
