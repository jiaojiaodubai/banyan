interface nsIXPCComponents_Utils {
  cloneInto<T>(value: T, scope: object, options?: object): T;
  waiveXrays<T>(value: T): T;
}
