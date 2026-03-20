// ========================================================================
// utils/CodeNormalizer.ts
// 代码标准化预处理 - 在比较前抹掉"无关修改"
// 场景：AI 生成模板代码后，开发者做了改变量名、加日志、改 CSS 值等微调，
//       这些修改应视为"无变化"（100% 相似）
// ========================================================================

import { parse, ParserOptions } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

export interface NormalizeOptions {
  removeConsole: boolean;
  removeDebugger: boolean;
  normalizeCSSValues: boolean;
  normalizeIdentifiers: boolean;
  removeComments: boolean;
}

const DEFAULT_OPTIONS: NormalizeOptions = {
  removeConsole: true,
  removeDebugger: true,
  normalizeCSSValues: true,
  normalizeIdentifiers: true,
  removeComments: true,
};

/**
 * 对代码做标准化预处理，抹掉"无关修改"
 */
export function normalizeCode(
  code: string,
  _language: string = 'javascript',
  options: Partial<NormalizeOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const plugins: ParserOptions['plugins'] = [
      'jsx',
      'typescript',
      'decorators-legacy',
      'classProperties',
      'optionalChaining',
      'nullishCoalescingOperator',
      'dynamicImport',
    ];

    const ast = parse(code, {
      sourceType: 'module',
      plugins,
      errorRecovery: true,
    });

    const identifierMap = new Map<string, string>();
    let idCounter = 0;

    const reservedNames = new Set([
      'React', 'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
      'useContext', 'useReducer', 'useLayoutEffect',
      'Component', 'PureComponent', 'Fragment',
      'console', 'window', 'document', 'module', 'exports', 'require',
      'import', 'export', 'default', 'from',
      'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean',
      'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Date', 'RegExp',
      'Error', 'TypeError', 'RangeError', 'JSON', 'Math', 'parseInt', 'parseFloat',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'fetch', 'Request', 'Response', 'Headers', 'URL',
      'undefined', 'null', 'NaN', 'Infinity',
      'true', 'false',
      'props', 'state', 'children', 'className', 'style', 'key', 'ref',
      'onClick', 'onChange', 'onSubmit', 'onFocus', 'onBlur',
      'e', 'event', 'err', 'error',
      'this', 'super', 'self',
      'process', 'global', 'Buffer',
    ]);

    function getOrCreateAlias(name: string): string {
      if (reservedNames.has(name)) return name;
      if (!identifierMap.has(name)) {
        identifierMap.set(name, `_v${idCounter++}_`);
      }
      return identifierMap.get(name)!;
    }

    // CSS 属性值模式：数字+单位、颜色值
    const cssValuePattern = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|\d+(\.\d+)?(px|em|rem|%|vh|vw|pt|cm|mm|in|s|ms|deg|rad|turn|fr)?)$/;
    const cssPropertyNames = new Set([
      'color', 'backgroundColor', 'background', 'border', 'borderColor',
      'borderRadius', 'borderWidth', 'margin', 'marginTop', 'marginBottom',
      'marginLeft', 'marginRight', 'padding', 'paddingTop', 'paddingBottom',
      'paddingLeft', 'paddingRight', 'width', 'height', 'minWidth', 'maxWidth',
      'minHeight', 'maxHeight', 'fontSize', 'fontWeight', 'lineHeight',
      'letterSpacing', 'textAlign', 'display', 'flex', 'flexDirection',
      'justifyContent', 'alignItems', 'gap', 'top', 'bottom', 'left', 'right',
      'zIndex', 'opacity', 'overflow', 'position', 'transform', 'transition',
      'boxShadow', 'textDecoration', 'cursor', 'outline', 'gridTemplateColumns',
      'gridTemplateRows', 'gridGap', 'columnGap', 'rowGap',
    ]);

    traverse(ast, {
      // 1. 移除 console.xxx() 调用
      ExpressionStatement(path) {
        if (!opts.removeConsole) return;
        const expr = path.node.expression;
        if (
          t.isCallExpression(expr) &&
          t.isMemberExpression(expr.callee) &&
          t.isIdentifier(expr.callee.object, { name: 'console' })
        ) {
          path.remove();
        }
      },

      // 2. 移除 debugger
      DebuggerStatement(path) {
        if (opts.removeDebugger) {
          path.remove();
        }
      },

      // 3. CSS 值归一化：style={{ color: '#fff' }} → style={{ color: '_CSS_' }}
      ObjectProperty(path) {
        if (!opts.normalizeCSSValues) return;
        const key = path.node.key;
        let propName = '';
        if (t.isIdentifier(key)) propName = key.name;
        else if (t.isStringLiteral(key)) propName = key.value;

        if (cssPropertyNames.has(propName)) {
          const val = path.node.value;
          if (t.isStringLiteral(val) && cssValuePattern.test(val.value)) {
            path.node.value = t.stringLiteral('_CSS_');
          } else if (t.isNumericLiteral(val)) {
            path.node.value = t.numericLiteral(0);
          }
        }
      },

      // 4. 变量/函数名归一化
      Identifier(path) {
        if (!opts.normalizeIdentifiers) return;

        // 跳过对象属性的 key（a.b 中的 b）
        if (t.isMemberExpression(path.parent) && path.parent.property === path.node && !path.parent.computed) {
          return;
        }
        // 跳过对象属性定义的 key（{ a: 1 } 中的 a）
        if (t.isObjectProperty(path.parent) && path.parent.key === path.node && !path.parent.computed) {
          return;
        }
        // 跳过 import 说明符的 imported 部分（import { xxx } from ...）
        if (t.isImportSpecifier(path.parent) && path.parent.imported === path.node) {
          return;
        }
        // 跳过 JSX 标签名
        if (t.isJSXIdentifier(path.node)) return;
        // 跳过 export 标识符、类型注解中的标识符
        if (t.isTSTypeReference(path.parent)) return;

        path.node.name = getOrCreateAlias(path.node.name);
      },
    });

    // 5. 移除注释
    if (opts.removeComments) {
      ast.comments = [];
      traverse(ast, {
        enter(path) {
          t.removeComments(path.node);
        },
      });
    }

    const output = generate(ast, {
      comments: false,
      compact: false,
      retainLines: false,
    });

    return output.code;
  } catch (error) {
    console.warn('代码标准化失败，返回原始代码:', error);
    return code;
  }
}
