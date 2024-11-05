export interface ModuleMetadata {
  name: string;
  filePath?: string;
  imports: ImportMetadata[];
  exports: string[];
  providers: ProviderMetadata[];
  controllers: string[];
  entityCount: number;
}

export interface ImportMetadata {
  name: string;
  path?: string;
  isAsync?: boolean;
  dependencies?: string[];
  isForwardReference?: boolean;
  module?: Partial<ModuleMetadata>;
}

export interface ProviderMetadata {
  name: string;
  type: 'class' | 'value' | 'factory';
  dependencies: string[];
  isInjectable: boolean;
  provide?: string;
  useClass?: string;
  useValue?: any;
  useFactory?: string;
  inject?: string[];
}

export interface ControllerMetadata {
  name: string;
  path: string;
  dependencies: string[];
}
