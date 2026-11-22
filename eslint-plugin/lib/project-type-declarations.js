'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const parsedFilesByCompiler = new WeakMap();
const typescriptExtension = /\.(?:[cm]?ts|tsx)$/i;
const compatibilityInstall = 'npm install -D typescript@npm:@typescript/typescript6@latest @typescript/cli@npm:typescript@latest';

/**
 * Runs a rule against a fresh project catalog and reports project read problems.
 * @param {object} parameters ESLint's context and the rule's project inspection.
 * @returns {object} A Program listener for TypeScript files.
 * @example createProjectDeclarationListener({ context, inspectProject });
 */
function createProjectDeclarationListener({ context, inspectProject }) {
  const filename = path.resolve(context.cwd, context.filename);
  if (!typescriptExtension.test(filename)) return {};
  return {
    Program() {
      const project = readProjectTypeDeclarations({ filename, text: context.sourceCode.text });
      switch (project.kind) {
        case 'project':
          for (const problem of project.problems) {
            context.report({ loc: { line: 1, column: 0 }, message: describeProjectProblem(problem) });
          }
          inspectProject(project);
          return;
        case 'project-unavailable':
          context.report({ loc: { line: 1, column: 0 }, message: describeProjectProblem(project.problem) });
          return;
      }
    },
  };
}

function readProjectTypeDeclarations({ filename, text }) {
  const startDirectory = path.dirname(filename);
  const configuration = findProjectConfiguration(startDirectory);
  switch (configuration.kind) {
    case 'project-unavailable': return configuration;
    case 'configuration': break;
  }
  const projectRoot = path.dirname(configuration.filename);
  const loaded = loadProjectCompiler({ projectRoot, startDirectory });
  switch (loaded.kind) {
    case 'project-unavailable': return loaded;
    case 'compiler': break;
  }
  const compiler = loaded.compiler;
  const readProblems = [];
  const readConfiguration = (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch (cause) {
      if (!cause.code) throw cause;
      readProblems.push({ kind: 'configuration-unreadable', filename: file, code: cause.code, cause: cause.message });
      return undefined;
    }
  };
  const configured = compiler.readConfigFile(configuration.filename, readConfiguration);
  if (readProblems.length > 0) {
    return { kind: 'project-unavailable', problem: { kind: 'configuration-reads-failed', problems: readProblems } };
  }
  if (configured.error) {
    return { kind: 'project-unavailable', problem: configurationDiagnostic({ compiler, filename: configuration.filename, diagnostics: [configured.error] }) };
  }
  const parsed = compiler.parseJsonConfigFileContent(configured.config, {
    ...compiler.sys,
    readFile: readConfiguration,
  }, projectRoot, undefined, configuration.filename);
  if (readProblems.length > 0) {
    return { kind: 'project-unavailable', problem: { kind: 'configuration-reads-failed', problems: readProblems } };
  }
  if (parsed.errors.length > 0) {
    return { kind: 'project-unavailable', problem: configurationDiagnostic({ compiler, filename: configuration.filename, diagnostics: parsed.errors }) };
  }

  const localFile = canonicalFilename({ compiler, filename });
  const declarations = [];
  const problems = [];
  const files = new Map();
  for (const file of parsed.fileNames) {
    if (typescriptExtension.test(file)) files.set(canonicalFilename({ compiler, filename: file }), file);
  }
  for (const [canonicalFile, file] of [...files.entries()].sort()) {
    let source;
    if (canonicalFile === localFile) source = text;
    else {
      try {
        source = fs.readFileSync(file, 'utf8');
      } catch (cause) {
        if (!cause.code) throw cause;
        problems.push({ kind: 'source-unreadable', filename: file, code: cause.code, cause: cause.message });
        continue;
      }
    }
    const parsedFile = parseProjectFile({ compiler, filename: canonicalFile, text: source });
    const relativePath = path.relative(projectRoot, file).split(path.sep).join('/');
    for (const declaration of parsedFile.declarations) {
      declarations.push({ ...declaration, file: canonicalFile, relativePath });
    }
  }
  return { kind: 'project', compiler, projectRoot, localFile, declarations, problems };
}

function findProjectConfiguration(startDirectory) {
  const searched = [];
  let directory = startDirectory;
  while (true) {
    const filename = path.join(directory, 'tsconfig.json');
    searched.push(filename);
    try {
      fs.accessSync(filename);
      return { kind: 'configuration', filename };
    } catch (cause) {
      if (cause.code !== 'ENOENT') {
        if (!cause.code) throw cause;
        return { kind: 'project-unavailable', problem: { kind: 'configuration-unreadable', filename, code: cause.code, cause: cause.message } };
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return { kind: 'project-unavailable', problem: { kind: 'configuration-missing', startDirectory, searched } };
    }
    directory = parent;
  }
}

function loadProjectCompiler({ projectRoot, startDirectory }) {
  let modulePath;
  try {
    modulePath = require.resolve('typescript', { paths: [projectRoot] });
  } catch (cause) {
    if (cause.code !== 'MODULE_NOT_FOUND') throw cause;
    return { kind: 'project-unavailable', problem: { kind: 'compiler-missing', projectRoot, startDirectory, cause: cause.message } };
  }
  let compiler;
  try {
    compiler = require(modulePath);
  } catch (cause) {
    return { kind: 'project-unavailable', problem: { kind: 'compiler-unreadable', modulePath, cause: String(cause) } };
  }
  const required = ['readConfigFile', 'parseJsonConfigFileContent', 'createSourceFile', 'forEachChild', 'createPrinter', 'flattenDiagnosticMessageText'];
  if (compiler === null || typeof compiler === 'undefined') {
    return { kind: 'project-unavailable', problem: { kind: 'compiler-exports-invalid', modulePath, exported: String(compiler) } };
  }
  const missing = required.filter((name) => typeof compiler[name] !== 'function');
  if (!compiler.sys || !compiler.SyntaxKind || !compiler.ScriptTarget || !compiler.EmitHint) missing.push('sys/SyntaxKind/ScriptTarget/EmitHint');
  if (compiler.sys && typeof compiler.sys.realpath !== 'function') missing.push('sys.realpath');
  if (!compiler.factory || typeof compiler.factory.createStringLiteral !== 'function') missing.push('factory.createStringLiteral');
  if (missing.length > 0) {
    return { kind: 'project-unavailable', problem: { kind: 'compiler-api-missing', modulePath, version: compiler.version, missing } };
  }
  return { kind: 'compiler', compiler };
}

function configurationDiagnostic({ compiler, filename, diagnostics }) {
  return {
    kind: 'configuration-invalid',
    filename,
    diagnostics: diagnostics.map((diagnostic) => {
      const details = { code: diagnostic.code, message: compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n') };
      if (!diagnostic.file || typeof diagnostic.start !== 'number') return { kind: 'project-diagnostic', ...details };
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return { kind: 'file-diagnostic', ...details, filename: diagnostic.file.fileName, line: position.line + 1, column: position.character + 1 };
    }),
  };
}

function canonicalFilename({ compiler, filename }) {
  const absolute = path.resolve(compiler.sys.realpath(filename));
  if (compiler.sys.useCaseSensitiveFileNames) return absolute;
  return absolute.toLowerCase();
}

function parseProjectFile({ compiler, filename, text }) {
  let files = parsedFilesByCompiler.get(compiler);
  if (!files) {
    files = new Map();
    parsedFilesByCompiler.set(compiler, files);
  }
  const digest = createHash('sha256').update(text).digest('hex');
  const previous = files.get(filename);
  if (previous && previous.digest === digest) return previous;
  const sourceFile = compiler.createSourceFile(filename, text, compiler.ScriptTarget.Latest, true);
  const declarations = [];
  function visit(node) {
    switch (node.kind) {
      case compiler.SyntaxKind.TypeAliasDeclaration: {
        declarations.push({ ...declarationLocation({ node, sourceFile }), kind: 'alias', type: node.type });
        break;
      }
      case compiler.SyntaxKind.InterfaceDeclaration: {
        declarations.push({ ...declarationLocation({ node, sourceFile }), kind: 'interface', members: node.members });
        break;
      }
    }
    compiler.forEachChild(node, visit);
  }
  visit(sourceFile);
  const parsed = { digest, declarations };
  files.set(filename, parsed);
  return parsed;
}

function declarationLocation({ node, sourceFile }) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.end);
  return {
    name: node.name.text,
    line: start.line + 1,
    loc: { start: { line: start.line + 1, column: start.character }, end: { line: end.line + 1, column: end.character } },
  };
}

/**
 * Reads string variants from unions and the configured discriminator fields.
 * @param {object} parameters The compiler, type node and discriminator names.
 * @returns {string[]} The literal values in syntax order.
 * @example collectStringVariants({ compiler, type, discriminatorNames: new Set(['kind']) });
 */
function collectStringVariants({ compiler, type, discriminatorNames }) {
  const unwrapped = unwrapParenthesizedType({ compiler, type });
  switch (unwrapped.kind) {
    case compiler.SyntaxKind.UnionType:
      return unwrapped.types.flatMap((member) => collectStringVariants({ compiler, type: member, discriminatorNames }));
    case compiler.SyntaxKind.LiteralType:
      if (unwrapped.literal.kind === compiler.SyntaxKind.StringLiteral) return [unwrapped.literal.text];
      return [];
    case compiler.SyntaxKind.TypeLiteral:
      return unwrapped.members.flatMap((member) => {
        if (member.kind !== compiler.SyntaxKind.PropertySignature || !member.type || !discriminatorNames.has(member.name.text)) return [];
        return collectStringVariants({ compiler, type: member.type, discriminatorNames: new Set() });
      });
    default:
      return [];
  }
}

/**
 * Reads the type inside grouping parentheses.
 * @param {object} parameters The compiler and a type node.
 * @returns {object} The first type node that is not parenthesized.
 * @example unwrapParenthesizedType({ compiler, type });
 */
function unwrapParenthesizedType({ compiler, type }) {
  switch (type.kind) {
    case compiler.SyntaxKind.ParenthesizedType:
      return unwrapParenthesizedType({ compiler, type: type.type });
    default:
      return type;
  }
}

function describeProjectProblem(problem) {
  switch (problem.kind) {
    case 'configuration-missing':
      return `Cross-file analysis requires tsconfig.json; searched upwards from ${problem.startDirectory}: ${problem.searched.join(', ')}.`;
    case 'configuration-unreadable':
      return `Cannot read TypeScript configuration ${problem.filename} (${problem.code}): ${problem.cause}`;
    case 'configuration-reads-failed':
      return problem.problems.map(describeProjectProblem).join('\n');
    case 'configuration-invalid':
      return `Invalid TypeScript configuration ${problem.filename}: ${problem.diagnostics.map(describeConfigurationDiagnostic).join('\n')}`;
    case 'compiler-missing':
      return `Cannot resolve the TypeScript compiler API ('typescript') from project ${problem.projectRoot}, starting at ${problem.startDirectory}: ${problem.cause}. Install the compatibility API and native compiler: ${compatibilityInstall}`;
    case 'compiler-unreadable':
      return `Cannot load the TypeScript compiler API at ${problem.modulePath}: ${problem.cause}. Install the compatibility API and native compiler: ${compatibilityInstall}`;
    case 'compiler-exports-invalid':
      return `The resolved TypeScript module at ${problem.modulePath} exports ${problem.exported} instead of a compiler API. Install the compatibility API and native compiler: ${compatibilityInstall}`;
    case 'compiler-api-missing':
      return `The resolved TypeScript module at ${problem.modulePath} (version ${problem.version}) lacks compiler API members: ${problem.missing.join(', ')}. Install the compatibility API and native compiler: ${compatibilityInstall}`;
    case 'source-unreadable':
      return `Cannot read TypeScript project file ${problem.filename} (${problem.code}): ${problem.cause}`;
  }
}

function describeConfigurationDiagnostic(diagnostic) {
  switch (diagnostic.kind) {
    case 'file-diagnostic':
      return `TS${diagnostic.code}: ${diagnostic.filename}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`;
    case 'project-diagnostic':
      return `TS${diagnostic.code}: ${diagnostic.message}`;
  }
}

module.exports = { createProjectDeclarationListener, collectStringVariants, unwrapParenthesizedType };
