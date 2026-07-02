declare module "resource://gre/modules/Subprocess.sys.mjs" {
  export type SubprocessReadable = {
    readString?: () => Promise<string | null>;
  };

  export type SubprocessWritable = {
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  };

  export type SubprocessProcess = {
    stdin: SubprocessWritable;
    stdout: SubprocessReadable;
    stderr: SubprocessReadable;
    wait: () => Promise<{ exitCode?: number } | undefined>;
    kill: (timeout?: number) => Promise<void>;
    exitCode?: number;
    exitValue?: number;
  };

  export type SubprocessCallOptions = {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    workdir?: string;
    stdin?: "pipe";
    stdout?: "pipe";
    stderr?: "pipe";
  };

  export const Subprocess: {
    call: (options: SubprocessCallOptions) => Promise<SubprocessProcess>;
  };
}
