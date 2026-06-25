export class SemirCliError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class ArgumentError extends SemirCliError {
  constructor(message: string) {
    super('ARGUMENT', message, 2);
  }
}

export class EmptyResultError extends SemirCliError {
  constructor(message: string) {
    super('EMPTY_RESULT', message, 66);
  }
}

export class AuthRequiredError extends SemirCliError {
  constructor(message = '森马云盘登录态不可用，请确认 9222 浏览器中已登录森马云盘。') {
    super('AUTH_REQUIRED', message, 77);
  }
}

export class CommandExecutionError extends SemirCliError {
  constructor(message: string) {
    super('COMMAND_EXEC', message, 1);
  }
}
