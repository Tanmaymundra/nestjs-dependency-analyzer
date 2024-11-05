import { ImportMetadata, ModuleMetadata, ProviderMetadata } from '../types/modules.types';
import * as ts from 'typescript';

export class AstParser {
  private readonly sourceFile: ts.SourceFile;
  private uniqueIdCounter = 1;
  private readonly moduleCache = new Map<string, ModuleMetadata>();
  private readonly providerCache = new Map<string, ProviderMetadata>();

  constructor(sourceCode: string, fileName: string) {
    this.sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);
  }

  private generateUniqueName(prefix: string): string {
    return `${prefix}_${this.uniqueIdCounter++}`;
  }

  private findDecorator(node: ts.ClassDeclaration, name: string): ts.Decorator | undefined {
    const decorators = ts.getDecorators(node);
    if (!decorators) return undefined;

    return decorators.find((decorator) => {
      if (!ts.isCallExpression(decorator.expression)) return false;

      const expression = decorator.expression.expression;
      if (ts.isIdentifier(expression)) {
        return expression.text === name;
      }

      if (ts.isPropertyAccessExpression(expression)) {
        return expression.name.text === name;
      }

      return false;
    });
  }

  public parseModule(): ModuleMetadata | null {
    const moduleClass = this.findModuleClass();
    if (!moduleClass) return null;

    const metadata = this.parseModuleDecorator(moduleClass);
    if (!metadata.name) return null;

    this.moduleCache.set(metadata.name, metadata);
    this.enrichWithSecondLevelDependencies(metadata);

    return metadata;
  }

  private findModuleClass(): ts.ClassDeclaration | undefined {
    return this.sourceFile.statements.find(
      (stmt): stmt is ts.ClassDeclaration =>
        ts.isClassDeclaration(stmt) &&
        !!stmt.name?.text && // Ensure the class has a name
        this.hasDecorator(stmt, 'Module') &&
        !stmt.name.text.includes('Unknown') && // Filter out unknown modules
        !stmt.name.text.includes('Angular'), // Filter out incorrectly parsed modules
    );
  }

  private hasDecorator(node: ts.ClassDeclaration, name: string): boolean {
    return !!this.findDecorator(node, name);
  }

  private parseModuleDecorator(node: ts.ClassDeclaration): ModuleMetadata {
    const decorator = this.findDecorator(node, 'Module');
    if (!decorator || !ts.isCallExpression(decorator.expression)) {
      return this.createEmptyModuleMetadata();
    }

    const argument = decorator.expression.arguments[0];
    if (!argument || !ts.isObjectLiteralExpression(argument)) {
      return this.createEmptyModuleMetadata();
    }

    return {
      name: node.name?.text ?? this.generateUniqueName('Module'),
      filePath: this.sourceFile.fileName,
      imports: this.extractImports(argument),
      exports: this.extractExports(argument),
      providers: this.extractProviders(argument),
      controllers: this.extractControllers(argument),
      entityCount: this.extractEntityCount(argument),
    };
  }

  private enrichWithSecondLevelDependencies(module: ModuleMetadata): void {
    module.imports = module.imports.map((importMeta) => ({
      ...importMeta,
      dependencies: this.getModuleDependencies(importMeta.name),
    }));

    module.providers = module.providers.map((provider) => ({
      ...provider,
      dependencies: this.getProviderDependencyTree(provider.name),
    }));
  }

  private getModuleDependencies(moduleName: string): string[] {
    const cachedModule = this.moduleCache.get(moduleName);
    if (!cachedModule) return [];

    return [...cachedModule.imports.map((imp) => imp.name), ...cachedModule.providers.map((prov) => prov.name)];
  }

  private getProviderDependencyTree(providerName: string, visited = new Set<string>()): string[] {
    if (visited.has(providerName)) return [];
    visited.add(providerName);

    const provider = this.providerCache.get(providerName);
    if (!provider) return [];

    const directDeps = provider.dependencies ?? [];
    const nestedDeps = directDeps.flatMap((dep) => this.getProviderDependencyTree(dep, visited));

    return [...new Set([...directDeps, ...nestedDeps])];
  }

  private extractImports(node: ts.ObjectLiteralExpression): ImportMetadata[] {
    const imports = this.findPropertyAssignment(node, 'imports');
    if (!imports || !ts.isArrayLiteralExpression(imports.initializer)) {
      return [];
    }

    return imports.initializer.elements.map((element) => {
      if (ts.isIdentifier(element)) {
        return this.createImportMetadata(element);
      }

      if (ts.isCallExpression(element)) {
        return this.parseAsyncImport(element);
      }

      return this.createUnknownImport();
    });
  }

  private extractEntityCount(node: ts.ObjectLiteralExpression): number {
    const imports = this.findPropertyAssignment(node, 'imports');
    if (!imports || !ts.isArrayLiteralExpression(imports.initializer)) {
      return 0;
    }

    let entityCount = 0;

    for (const element of imports.initializer.elements) {
      if (ts.isCallExpression(element)) {
        // Check for TypeOrmModule.forFeature([...entities])
        if (ts.isPropertyAccessExpression(element.expression)) {
          const fullExpression = element.expression.getText();
          if (fullExpression === 'TypeOrmModule.forFeature') {
            const [entityArray] = element.arguments;
            if (ts.isArrayLiteralExpression(entityArray)) {
              entityCount += entityArray.elements.length;
            }
          }
        }

        // Check for TypeOrmModule.forRoot({ entities: [...] })
        if (ts.isPropertyAccessExpression(element.expression) && element.expression.expression.getText() === 'TypeOrmModule') {
          const [config] = element.arguments;
          if (ts.isObjectLiteralExpression(config)) {
            const entitiesProperty = this.findPropertyAssignment(config, 'entities');
            if (entitiesProperty && ts.isArrayLiteralExpression(entitiesProperty.initializer)) {
              entityCount += entitiesProperty.initializer.elements.length;
            }
          }
        }

        // Check for MongooseModule.forFeature([...models])
        if (ts.isPropertyAccessExpression(element.expression)) {
          const fullExpression = element.expression.getText();
          if (fullExpression === 'MongooseModule.forFeature') {
            const [modelArray] = element.arguments;
            if (ts.isArrayLiteralExpression(modelArray)) {
              entityCount += modelArray.elements.length;
            }
          }
        }

        // Check for SequelizeModule.forFeature([...models])
        if (ts.isPropertyAccessExpression(element.expression)) {
          const fullExpression = element.expression.getText();
          if (fullExpression === 'SequelizeModule.forFeature') {
            const [modelArray] = element.arguments;
            if (ts.isArrayLiteralExpression(modelArray)) {
              entityCount += modelArray.elements.length;
            }
          }
        }
      }
    }
    return entityCount;
  }

  private createImportMetadata(identifier: ts.Identifier): ImportMetadata {
    return {
      name: identifier.text,
      path: this.resolveImportPath(identifier),
      isAsync: false,
      dependencies: [],
    };
  }

  private resolveImportPath(identifier: ts.Node): string | undefined {
    const importDecl = this.sourceFile.statements.find((stmt): stmt is ts.ImportDeclaration => {
      if (!ts.isImportDeclaration(stmt)) return false;
      const { importClause } = stmt;
      if (!importClause) return false;

      // Check for default imports
      if (importClause.name?.text === identifier.getText()) return true;

      const namedImports = importClause.namedBindings;
      if (!namedImports) return false;

      // Check for named imports
      if (ts.isNamedImports(namedImports)) {
        return namedImports.elements.some((element) => element.name.text === identifier.getText());
      }

      // Check for namespace imports
      if (ts.isNamespaceImport(namedImports)) {
        return namedImports.name.text === identifier.getText();
      }

      return false;
    });

    if (!importDecl?.moduleSpecifier || !ts.isStringLiteral(importDecl.moduleSpecifier)) {
      return undefined;
    }

    const path = importDecl.moduleSpecifier.text;
    if (path.startsWith('@nestjs/')) {
      return path.split('/').pop();
    }
    return path;
  }

  private parseAsyncImport(callExpression: ts.CallExpression): ImportMetadata {
    // Handle forwardRef case
    if (ts.isIdentifier(callExpression.expression) && callExpression.expression.text === 'forwardRef') {
      // forwardRef should have one argument that is an arrow function
      const arrowFunc = callExpression.arguments[0];
      if (arrowFunc && ts.isArrowFunction(arrowFunc)) {
        const returnExpr = arrowFunc.body;
        if (ts.isIdentifier(returnExpr)) {
          return {
            name: returnExpr.text,
            path: this.resolveImportPath(returnExpr),
            isAsync: true,
            isForwardReference: true,
            dependencies: [],
          };
        }
      }
      return this.createUnknownImport();
    }

    // Handle other async imports (like TypeOrmModule.forRoot())
    if (!ts.isIdentifier(callExpression.expression)) {
      if (ts.isPropertyAccessExpression(callExpression.expression)) {
        const moduleName = callExpression.expression.expression.getText();
        return {
          name: moduleName,
          path: this.resolveImportPath(callExpression.expression.expression as ts.Identifier),
          isAsync: true,
          dependencies: [],
        };
      }
      return this.createUnknownImport();
    }

    return {
      name: callExpression.expression.text,
      path: this.resolveImportPath(callExpression.expression as ts.Identifier),
      isAsync: true,
      dependencies: [],
    };
  }
  private extractExports(node: ts.ObjectLiteralExpression): string[] {
    const exportsProp = this.findPropertyAssignment(node, 'exports');
    if (!exportsProp || !ts.isArrayLiteralExpression(exportsProp.initializer)) {
      return [];
    }

    return exportsProp.initializer.elements.filter(ts.isIdentifier).map((identifier) => identifier.text);
  }

  private extractControllers(node: ts.ObjectLiteralExpression): string[] {
    const controllersProp = this.findPropertyAssignment(node, 'controllers');
    if (!controllersProp || !ts.isArrayLiteralExpression(controllersProp.initializer)) {
      return [];
    }

    return controllersProp.initializer.elements.filter(ts.isIdentifier).map((identifier) => identifier.text);
  }

  private extractProviders(node: ts.ObjectLiteralExpression): ProviderMetadata[] {
    const providers = this.findPropertyAssignment(node, 'providers');
    if (!providers || !ts.isArrayLiteralExpression(providers.initializer)) {
      return [];
    }

    return providers.initializer.elements
      .map((element) => this.parseProvider(element))
      .filter((provider): provider is ProviderMetadata => !!provider);
  }

  private parseProvider(element: ts.Expression): ProviderMetadata | null {
    if (ts.isIdentifier(element)) {
      const provider = this.createProviderMetadata(element);
      this.providerCache.set(provider.name, provider);
      return provider;
    }

    if (ts.isObjectLiteralExpression(element)) {
      return this.parseProviderObjectLiteral(element);
    }

    return null;
  }

  private parseProviderObjectLiteral(node: ts.ObjectLiteralExpression): ProviderMetadata | null {
    const provide = this.getPropertyValue(node, 'provide');
    if (!provide) return null;

    const useClass = this.getPropertyValue(node, 'useClass');
    const useValue = this.getPropertyValue(node, 'useValue');
    const useFactory = this.getPropertyValue(node, 'useFactory');

    let type: 'class' | 'value' | 'factory' = 'class';
    let dependencies: string[] = [];
    let name = provide;

    if (useClass) {
      type = 'class';
      const classDecl = this.findClassDeclaration(useClass);
      dependencies = classDecl ? this.extractConstructorDependencies(classDecl) : [];
    } else if (useFactory) {
      type = 'factory';
      const inject = this.getArrayPropertyValue(node, 'inject') || [];
      dependencies = inject;
    } else if (useValue !== undefined) {
      type = 'value';
    }

    const metadata: ProviderMetadata = {
      name,
      type,
      dependencies,
      isInjectable: type === 'class' && this.isClassInjectable(useClass || name),
      provide,
      useClass,
      useValue,
      useFactory,
      inject: dependencies,
    };

    this.providerCache.set(name, metadata);
    return metadata;
  }

  private findPropertyAssignment(node: ts.ObjectLiteralExpression, propertyName: string): ts.PropertyAssignment | undefined {
    return node.properties.find(
      (prop): prop is ts.PropertyAssignment =>
        ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === propertyName,
    );
  }

  private getPropertyValue(node: ts.ObjectLiteralExpression, propertyName: string): string | undefined {
    const property = this.findPropertyAssignment(node, propertyName);
    if (!property) return undefined;

    if (ts.isIdentifier(property.initializer)) {
      return property.initializer.text;
    }
    if (ts.isStringLiteral(property.initializer)) {
      return property.initializer.text;
    }
    return undefined;
  }

  private getArrayPropertyValue(node: ts.ObjectLiteralExpression, propertyName: string): string[] | undefined {
    const property = this.findPropertyAssignment(node, propertyName);
    if (!property || !ts.isArrayLiteralExpression(property.initializer)) {
      return undefined;
    }

    return property.initializer.elements.filter(ts.isIdentifier).map((identifier) => identifier.text);
  }

  private createProviderMetadata(identifier: ts.Identifier): ProviderMetadata {
    const classDecl = this.findClassDeclaration(identifier.text);
    const dependencies = classDecl ? this.extractConstructorDependencies(classDecl) : [];

    return {
      name: identifier.text,
      type: 'class',
      dependencies,
      isInjectable: classDecl ? this.hasDecorator(classDecl, 'Injectable') : false,
      provide: identifier.text,
    };
  }

  private findClassDeclaration(className: string): ts.ClassDeclaration | undefined {
    return this.sourceFile.statements.find(
      (stmt): stmt is ts.ClassDeclaration => ts.isClassDeclaration(stmt) && stmt.name?.text === className,
    );
  }

  private extractConstructorDependencies(node: ts.ClassDeclaration): string[] {
    const constructor = node.members.find(ts.isConstructorDeclaration);
    if (!constructor) return [];

    return constructor.parameters
      .filter(
        (param): param is ts.ParameterDeclaration & { type: ts.TypeReferenceNode } => !!param.type && ts.isTypeReferenceNode(param.type),
      )
      .map((param) => param.type.typeName.getText());
  }

  private isClassInjectable(className: string): boolean {
    const classDecl = this.findClassDeclaration(className);
    return classDecl ? this.hasDecorator(classDecl, 'Injectable') : false;
  }

  private createUnknownImport(): ImportMetadata {
    return {
      name: `UnknownModule_${this.uniqueIdCounter++}`,
      isAsync: false,
      dependencies: [],
    };
  }

  private createEmptyModuleMetadata(): ModuleMetadata {
    return {
      name: this.generateUniqueName('Module'),
      imports: [],
      exports: [],
      providers: [],
      controllers: [],
      entityCount: 0,
    };
  }
}
