export type Initializable = {
  onModuleInit?: () => void | Promise<void>;
  initialize?: () => void | Promise<void>;
};
