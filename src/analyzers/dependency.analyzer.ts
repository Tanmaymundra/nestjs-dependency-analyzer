import * as fs from 'fs/promises';
import * as path from 'path';
import { AstParser } from '../parsers/ast.parser';
import { ModuleMetadata, ProviderMetadata } from '../types/modules.types';

export class DependencyAnalyzer {
  private modules: Map<string, ModuleMetadata> = new Map();

  constructor(private readonly basePath: string) {}

  public async analyze(): Promise<Map<string, ModuleMetadata>> {
    await this.scanDirectory(this.basePath);
    await this.resolveModuleDependencies();
    return this.modules;
  }

  private async scanDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath);
        } else if (this.isNestModule(entry.name)) {
          await this.parseModule(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
      throw error;
    }
  }

  private isNestModule(fileName: string): boolean {
    return /\.module\.ts$/.test(fileName);
  }

  private async parseModule(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parser = new AstParser(content, filePath);
      const moduleMetadata = parser.parseModule();

      if (moduleMetadata?.name) {
        this.modules.set(moduleMetadata.name, {
          ...moduleMetadata,
          filePath,
        });
      }
    } catch (error) {
      console.error(`Error parsing module ${filePath}:`, error);
      throw error;
    }
  }

  private async resolveModuleDependencies(): Promise<void> {
    this.modules.forEach((module) => {
      module.imports = module.imports.map((imp) => {
        const importedModule = Array.from(this.modules.values()).find((m) => m.name === imp.name);
        return {
          ...imp,
          path: importedModule?.filePath,
          module: importedModule
            ? {
                name: importedModule.name,
                providers: importedModule.providers,
                controllers: importedModule.controllers,
              }
            : undefined,
        };
      });

      // Resolve provider dependencies
      module.providers.forEach((provider) => {
        provider.dependencies = provider.dependencies.map((dep) => {
          const resolvedProvider = this.findProviderByName(dep);
          return resolvedProvider?.name ?? dep;
        });
      });
    });
  }

  private findProviderByName(name: string): ProviderMetadata | undefined {
    for (const module of this.modules.values()) {
      const provider = module.providers.find((p) => p.name === name || p.provide === name);
      if (provider) return provider;
    }
    return undefined;
  }
}
