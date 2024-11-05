import { ModuleMetadata } from '../types/modules.types';

export class DotVisualizer {
  constructor(private modules: Map<string, ModuleMetadata>) {}

  public generate(): string {
    const lines: string[] = [];

    // Start digraph with proper formatting
    lines.push('digraph {');
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box, style=filled, fillcolor=lightgray];');
    lines.push('');

    // Generate nodes
    this.modules.forEach((module, moduleName) => {
      const label = this.escapeLabel(
        `${moduleName}\\n` +
          `Controllers: ${module.controllers.length}\\n` +
          `Providers: ${module.providers.length}\\n` +
          `Imports: ${module.imports.length}\\n` +
          `Entities: ${module.entityCount}`,
      );

      lines.push(`  "${this.escapeName(moduleName)}" [label="${label}"];`);
    });
    lines.push('');

    // Generate module dependencies
    this.modules.forEach((module, moduleName) => {
      module.imports.forEach((imp) => {
        const edgeStyle = imp.isForwardReference ? '[label="imports (forward ref)", style=dashed, color=red]' : '[label="imports"]';

        lines.push(`  "${this.escapeName(moduleName)}" -> "${this.escapeName(imp.name)}" ${edgeStyle};`);
      });
    });

    // Generate provider dependencies
    this.modules.forEach((module) => {
      module.providers.forEach((provider) => {
        provider.dependencies.forEach((dep) => {
          lines.push(`  "${this.escapeName(provider.name)}" -> "${this.escapeName(dep)}" [color=blue, style=dashed];`);
        });
      });
    });

    lines.push('}');

    return lines.join('\n');
  }

  private escapeName(name: string): string {
    return name.replace(/"/g, '\\"');
  }

  private escapeLabel(label: string): string {
    return label.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  public async saveToFile(filePath: string): Promise<void> {
    const fs = require('fs').promises;
    const content = this.generate();

    // Ensure UTF-8 without BOM encoding
    const buffer = Buffer.from('\ufeff' + content, 'utf8').slice(1);
    await fs.writeFile(filePath, buffer);
  }
}
