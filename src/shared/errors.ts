export class BakefileNotFoundError extends Error {
  constructor() {
    super("Bakefile.ts not found");
    this.name = "BakefileNotFoundError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(name: string) {
    super(`Task '${name}' not found`);
    this.name = "TaskNotFoundError";
  }
}

export class DuplicateTaskError extends Error {
  constructor(name: string) {
    super(`Task '${name}' is already defined`);
    this.name = "DuplicateTaskError";
  }
}

export class CircularDependencyError extends Error {
  constructor(chain: string[]) {
    super(`Circular dependency: ${chain.join(" -> ")}`);
    this.name = "CircularDependencyError";
  }
}

export class DuplicateDefaultTaskError extends Error {
  constructor() {
    super("Default task is already set");
    this.name = "DuplicateDefaultTaskError";
  }
}

export class WildcardNoMatchError extends Error {
  constructor(pattern: string) {
    super(`Wildcard pattern '${pattern}' matched no tasks`);
    this.name = "WildcardNoMatchError";
  }
}
