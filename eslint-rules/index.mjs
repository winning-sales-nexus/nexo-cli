const DIRECTIVE =
    /^\s*(eslint-disable|eslint-enable|eslint\s|global\s|globals\s|exported\s|prettier-ignore|@ts-expect-error|@ts-ignore|@ts-nocheck|<reference)/;

const noComments = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Sem comentário solto no código. O porquê vive na mensagem de commit e no PR; a exceção é JSDoc (/** */) numa declaração, que aparece no hover de quem usa.'
        },
        schema: [],
        messages: {
            found: 'Comentário no código. O porquê vai na mensagem de commit ou no PR; se a declaração precisa de explicação no uso, escreva JSDoc (/** */). Diretivas (eslint-disable, @ts-expect-error) continuam liberadas.'
        }
    },
    create(context) {
        return {
            Program() {
                for (const comment of context.sourceCode.getAllComments()) {
                    const docBlock = comment.type === 'Block' && comment.value.startsWith('*');
                    if (comment.type === 'Shebang' || docBlock || DIRECTIVE.test(comment.value)) {
                        continue;
                    }
                    context.report({ loc: comment.loc, messageId: 'found' });
                }
            }
        };
    }
};

const noElse = {
    meta: {
        type: 'problem',
        docs: { description: 'Sem else. Trate o caso de saída primeiro e devolva; o caminho normal fica no nível de fora.' },
        schema: [],
        messages: {
            found: 'else. Inverta a condição e devolva cedo — o caminho normal do método não deve viver dentro de um bloco.'
        }
    },
    create(context) {
        return {
            IfStatement(node) {
                if (node.alternate) {
                    context.report({ node: node.alternate, messageId: 'found' });
                }
            }
        };
    }
};

const LOOPS = new Set(['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement']);
const ITERATORS = new Set(['map', 'forEach', 'filter', 'flatMap', 'reduce', 'some', 'every', 'find', 'findIndex']);
const SEARCHES = new Set(['find', 'findIndex', 'includes', 'indexOf', 'filter']);
const ARRAY_TYPE = /(\[\]|^(readonly )?(Readonly)?Array<)/;

function iteratingAncestor(node) {
    let current = node.parent;
    while (current) {
        if (LOOPS.has(current.type)) {
            return current;
        }
        if (isIteratorCallback(current)) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

function isIteratorCallback(node) {
    if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') {
        return false;
    }
    const call = node.parent;
    return call?.type === 'CallExpression' && call.callee?.type === 'MemberExpression' && ITERATORS.has(call.callee.property?.name ?? '');
}

const noSearchInLoop = {
    meta: {
        type: 'problem',
        docs: { description: 'Sem varredura de array dentro de iteração: é o quadrático que ninguém vê até a base crescer.' },
        schema: [],
        messages: {
            found: 'Busca em array ({{name}}) dentro de outra iteração: isso é O(n²). Monte um Map ou Set antes do laço e consulte por chave.'
        }
    },
    create(context) {
        const services = context.sourceCode.parserServices;
        if (!services?.program || !services.esTreeNodeToTSNodeMap) {
            return {};
        }
        const checker = services.program.getTypeChecker();
        const searchesAnArray = (receiver) => {
            const tsNode = services.esTreeNodeToTSNodeMap.get(receiver);
            if (!tsNode) {
                return false;
            }
            return ARRAY_TYPE.test(checker.typeToString(checker.getTypeAtLocation(tsNode)));
        };
        return {
            CallExpression(node) {
                const name = node.callee?.type === 'MemberExpression' ? (node.callee.property?.name ?? '') : '';
                if (!SEARCHES.has(name) || !iteratingAncestor(node) || !searchesAnArray(node.callee.object)) {
                    return;
                }
                context.report({ node, messageId: 'found', data: { name } });
            }
        };
    }
};

const noNestedLoops = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Sem laço dentro de laço. Para cada item do laço de fora, o de dentro varre tudo: O(n²). Reestruture para Map ou Set.'
        },
        schema: [],
        messages: {
            found: 'Laço aninhado dentro de outro: O(n²). Reestruture para uma única passada com Map ou Set construídos antes do laço de fora.'
        }
    },
    create(context) {
        const hasLoopAncestor = (node) => {
            let current = node.parent;
            while (current) {
                if (LOOPS.has(current.type)) {
                    return true;
                }
                current = current.parent;
            }
            return false;
        };
        const check = (node) => {
            if (hasLoopAncestor(node)) {
                context.report({ node, messageId: 'found' });
            }
        };
        return {
            ForStatement: check,
            ForOfStatement: check,
            ForInStatement: check,
            WhileStatement: check,
            DoWhileStatement: check
        };
    }
};

const COMMENT_KINDS = new Set(['Line', 'Block', 'Shebang']);

const maxLogicLines = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Conta só linhas de lógica dentro do corpo do método — ignora decorators (que ficam fora do nó MethodDefinition), comentários e linhas em branco. Substitui max-lines-per-function do core ESLint, que infla métodos de controller com Swagger decorators.'
        },
        schema: [
            {
                type: 'object',
                properties: {
                    max: { type: 'integer', minimum: 1 },
                    skipTestFiles: { type: 'boolean' }
                },
                additionalProperties: false
            }
        ],
        messages: {
            tooMany: "Método '{{name}}' tem {{count}} linhas de lógica (máximo {{max}}). Extraia helpers privados."
        }
    },
    create(context) {
        const options = context.options[0] ?? {};
        const max = options.max ?? 20;
        const skipTestFiles = options.skipTestFiles ?? true;
        const filename = context.filename ?? '';
        const isTestFile = /\.(spec|int-spec|e2e)\.[cm]?[jt]sx?$/.test(filename);
        const isMigration = /(^|\/)migrations\//.test(filename);
        if (skipTestFiles && (isTestFile || isMigration)) {
            return {};
        }
        return {
            FunctionDeclaration: check,
            FunctionExpression: check,
            ArrowFunctionExpression: check,
            MethodDefinition: check
        };
        function check(node) {
            if (!node.body || !node.body.loc) {
                return;
            }
            const sourceCode = context.sourceCode;
            const startLine = node.body.loc.start.line + 1;
            const endLine = node.body.loc.end.line - 1;
            if (endLine < startLine) {
                return;
            }
            const commentLines = new Set();
            for (const c of sourceCode.getCommentsInside(node.body)) {
                for (let ln = c.loc.start.line; ln <= c.loc.end.line; ln++) {
                    commentLines.add(ln);
                }
            }
            let count = 0;
            for (let ln = startLine; ln <= endLine; ln++) {
                const text = sourceCode.lines[ln - 1] ?? '';
                if (text.trim() === '') {
                    continue;
                }
                if (commentLines.has(ln)) {
                    continue;
                }
                count++;
            }
            if (count > max) {
                context.report({
                    node,
                    messageId: 'tooMany',
                    data: { name: nodeName(node), count: String(count), max: String(max) }
                });
            }
        }
    }
};

function nodeName(node) {
    if (node.type === 'MethodDefinition' || node.type === 'Property') {
        return node.key?.name ?? node.key?.value ?? '<anonymous>';
    }
    if (node.id?.name) {
        return node.id.name;
    }
    if (node.parent?.type === 'VariableDeclarator') {
        return node.parent.id?.name ?? '<anonymous>';
    }
    return '<anonymous>';
}

export default {
    rules: {
        'no-comments': noComments,
        'no-else': noElse,
        'no-search-in-loop': noSearchInLoop,
        'no-nested-loops': noNestedLoops,
        'max-logic-lines': maxLogicLines
    }
};
