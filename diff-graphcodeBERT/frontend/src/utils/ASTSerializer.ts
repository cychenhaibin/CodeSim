// ========================================================================
// utils/ASTSerializer.ts
// AST 序列化器 - 将 AST 转换为 SBT (Structure-Based Traversal) 格式
// SBT 是一种保留树结构信息的序列化方法，用于后续的向量编码
// ========================================================================

import { parse, ParserOptions } from '@babel/parser';
import * as t from '@babel/types';
import { normalizeCode } from './CodeNormalizer';

/**
 * SBT 序列化配置
 */
interface SBTConfig {
  // 是否泛化标识符（变量名等）
  generalizeIdentifiers: boolean;
  // 是否泛化字面量（字符串、数字等）
  generalizeLiterals: boolean;
  // 是否忽略子节点顺序（排序后比较）
  ignoreOrder: boolean;
  // 最大深度
  maxDepth: number;
}

const DEFAULT_CONFIG: SBTConfig = {
  generalizeIdentifiers: true,
  generalizeLiterals: true,
  ignoreOrder: true,
  maxDepth: 50,
};

/**
 * AST 节点信息（用于序列化）
 */
interface ASTNodeInfo {
  type: string;
  value?: string;
  children: ASTNodeInfo[];
}

/**
 * AST 序列化器
 * 将代码解析为 AST，然后转换为 SBT 格式字符串
 */
export class ASTSerializer {
  private config: SBTConfig;

  constructor(config: Partial<SBTConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 将代码序列化为 SBT 格式
   */
  serialize(code: string, language: string = 'javascript', preNormalize: boolean = true): string {
    try {
      const normalized = preNormalize ? normalizeCode(code, language) : code;
      const ast = this.parseCode(normalized, language);
      const nodeInfo = this.astToNodeInfo(ast.program, 0);
      return this.nodeInfoToSBT(nodeInfo);
    } catch (error) {
      console.error('AST 序列化失败:', error);
      return `( Program ( Error ) )`;
    }
  }

  /**
   * 获取 AST 的结构化信息（用于调试和展示）
   */
  getStructure(code: string, language: string = 'javascript'): ASTNodeInfo {
    const ast = this.parseCode(code, language);
    return this.astToNodeInfo(ast.program, 0);
  }

  /**
   * 解析代码为 AST
   */
  private parseCode(code: string, _language: string): t.File {
    const plugins: ParserOptions['plugins'] = [
      'jsx',
      'typescript',
      'decorators-legacy',
      'classProperties',
      'optionalChaining',
      'nullishCoalescingOperator',
      'dynamicImport',
    ];

    return parse(code, {
      sourceType: 'module',
      plugins,
      errorRecovery: true,
    });
  }

  /**
   * 将 AST 节点转换为 NodeInfo 结构
   */
  private astToNodeInfo(node: t.Node | null | undefined, depth: number): ASTNodeInfo {
    if (!node || depth > this.config.maxDepth) {
      return { type: '_EMPTY_', children: [] };
    }

    const info: ASTNodeInfo = {
      type: node.type,
      children: [],
    };

    // 处理不同类型的节点
    switch (node.type) {
      // === 标识符 ===
      case 'Identifier':
        info.value = this.config.generalizeIdentifiers ? '_ID_' : (node as t.Identifier).name;
        break;

      // === 字面量 ===
      case 'StringLiteral':
        info.value = this.config.generalizeLiterals ? '_STR_' : `"${(node as t.StringLiteral).value}"`;
        break;

      case 'NumericLiteral':
        info.value = this.config.generalizeLiterals ? '_NUM_' : String((node as t.NumericLiteral).value);
        break;

      case 'BooleanLiteral':
        info.value = this.config.generalizeLiterals ? '_BOOL_' : String((node as t.BooleanLiteral).value);
        break;

      case 'NullLiteral':
        info.value = '_NULL_';
        break;

      case 'RegExpLiteral':
        info.value = '_REGEX_';
        break;

      case 'TemplateLiteral':
        info.value = '_TEMPLATE_';
        // 处理模板字符串中的表达式
        const templateNode = node as t.TemplateLiteral;
        info.children = templateNode.expressions.map(expr => 
          this.astToNodeInfo(expr, depth + 1)
        );
        break;

      // === 二元操作符 ===
      case 'BinaryExpression':
      case 'LogicalExpression':
        const binNode = node as t.BinaryExpression | t.LogicalExpression;
        info.value = binNode.operator;
        info.children = [
          this.astToNodeInfo(binNode.left, depth + 1),
          this.astToNodeInfo(binNode.right, depth + 1),
        ];
        break;

      // === 一元操作符 ===
      case 'UnaryExpression':
      case 'UpdateExpression':
        const unaryNode = node as t.UnaryExpression | t.UpdateExpression;
        info.value = unaryNode.operator;
        info.children = [this.astToNodeInfo(unaryNode.argument, depth + 1)];
        break;

      // === 赋值 ===
      case 'AssignmentExpression':
        const assignNode = node as t.AssignmentExpression;
        info.value = assignNode.operator;
        info.children = [
          this.astToNodeInfo(assignNode.left, depth + 1),
          this.astToNodeInfo(assignNode.right, depth + 1),
        ];
        break;

      // === 函数定义 ===
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        const funcNode = node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;
        // 函数名（如果有）
        if ('id' in funcNode && funcNode.id) {
          info.children.push(this.astToNodeInfo(funcNode.id, depth + 1));
        }
        // 参数数量作为特征
        info.value = `params:${funcNode.params.length}`;
        // 参数类型（泛化）
        funcNode.params.forEach(param => {
          info.children.push(this.astToNodeInfo(param, depth + 1));
        });
        // 函数体
        info.children.push(this.astToNodeInfo(funcNode.body, depth + 1));
        break;

      // === 调用表达式 ===
      case 'CallExpression':
        const callNode = node as t.CallExpression;
        // 被调用的函数/方法
        info.children.push(this.astToNodeInfo(callNode.callee, depth + 1));
        // 参数数量
        info.value = `args:${callNode.arguments.length}`;
        // 参数（按结构）
        callNode.arguments.forEach(arg => {
          info.children.push(this.astToNodeInfo(arg, depth + 1));
        });
        break;

      // === 成员访问 ===
      case 'MemberExpression':
        const memberNode = node as t.MemberExpression;
        info.children = [
          this.astToNodeInfo(memberNode.object, depth + 1),
          this.astToNodeInfo(memberNode.property, depth + 1),
        ];
        info.value = memberNode.computed ? 'computed' : 'static';
        break;

      // === 条件表达式 ===
      case 'ConditionalExpression':
        const condNode = node as t.ConditionalExpression;
        info.children = [
          this.astToNodeInfo(condNode.test, depth + 1),
          this.astToNodeInfo(condNode.consequent, depth + 1),
          this.astToNodeInfo(condNode.alternate, depth + 1),
        ];
        break;

      // === JSX 元素 ===
      case 'JSXElement':
        const jsxNode = node as t.JSXElement;
        info.children.push(this.astToNodeInfo(jsxNode.openingElement, depth + 1));
        // JSX 子元素
        jsxNode.children.forEach(child => {
          if (t.isJSXElement(child) || t.isJSXFragment(child) || t.isJSXExpressionContainer(child)) {
            info.children.push(this.astToNodeInfo(child, depth + 1));
          }
        });
        break;

      case 'JSXOpeningElement':
        const openingNode = node as t.JSXOpeningElement;
        // 标签名
        if (t.isJSXIdentifier(openingNode.name)) {
          // 保留组件名（首字母大写）或泛化 HTML 标签
          const tagName = openingNode.name.name;
          if (tagName[0] === tagName[0].toUpperCase()) {
            // 自定义组件，保留名称
            info.value = tagName;
          } else {
            // HTML 标签，泛化
            info.value = this.config.generalizeIdentifiers ? '_TAG_' : tagName;
          }
        }
        // 属性（只保留属性名，不保留值）
        openingNode.attributes.forEach(attr => {
          if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
            const attrInfo: ASTNodeInfo = {
              type: 'JSXAttribute',
              value: attr.name.name,
              children: [],
            };
            // 如果属性值是表达式，记录结构
            if (attr.value && t.isJSXExpressionContainer(attr.value)) {
              attrInfo.children.push(this.astToNodeInfo(attr.value.expression, depth + 2));
            }
            info.children.push(attrInfo);
          }
        });
        break;

      case 'JSXFragment':
        const fragmentNode = node as t.JSXFragment;
        info.value = '_FRAGMENT_';
        fragmentNode.children.forEach(child => {
          if (t.isJSXElement(child) || t.isJSXFragment(child) || t.isJSXExpressionContainer(child)) {
            info.children.push(this.astToNodeInfo(child, depth + 1));
          }
        });
        break;

      // === 类定义 ===
      case 'ClassDeclaration':
      case 'ClassExpression':
        const classNode = node as t.ClassDeclaration | t.ClassExpression;
        if (classNode.id) {
          info.children.push(this.astToNodeInfo(classNode.id, depth + 1));
        }
        if (classNode.superClass) {
          info.children.push(this.astToNodeInfo(classNode.superClass, depth + 1));
        }
        info.children.push(this.astToNodeInfo(classNode.body, depth + 1));
        break;

      // === 变量声明 ===
      case 'VariableDeclaration':
        const varDeclNode = node as t.VariableDeclaration;
        info.value = varDeclNode.kind; // const, let, var
        varDeclNode.declarations.forEach(decl => {
          info.children.push(this.astToNodeInfo(decl, depth + 1));
        });
        break;

      case 'VariableDeclarator':
        const varDeclrNode = node as t.VariableDeclarator;
        info.children.push(this.astToNodeInfo(varDeclrNode.id, depth + 1));
        if (varDeclrNode.init) {
          info.children.push(this.astToNodeInfo(varDeclrNode.init, depth + 1));
        }
        break;

      // === 控制流 ===
      case 'IfStatement':
        const ifNode = node as t.IfStatement;
        info.children = [
          this.astToNodeInfo(ifNode.test, depth + 1),
          this.astToNodeInfo(ifNode.consequent, depth + 1),
        ];
        if (ifNode.alternate) {
          info.children.push(this.astToNodeInfo(ifNode.alternate, depth + 1));
        }
        break;

      case 'ForStatement':
        const forNode = node as t.ForStatement;
        info.children = [
          this.astToNodeInfo(forNode.init, depth + 1),
          this.astToNodeInfo(forNode.test, depth + 1),
          this.astToNodeInfo(forNode.update, depth + 1),
          this.astToNodeInfo(forNode.body, depth + 1),
        ];
        break;

      case 'ForOfStatement':
      case 'ForInStatement':
        const forOfNode = node as t.ForOfStatement | t.ForInStatement;
        info.children = [
          this.astToNodeInfo(forOfNode.left, depth + 1),
          this.astToNodeInfo(forOfNode.right, depth + 1),
          this.astToNodeInfo(forOfNode.body, depth + 1),
        ];
        break;

      case 'WhileStatement':
        const whileNode = node as t.WhileStatement;
        info.children = [
          this.astToNodeInfo(whileNode.test, depth + 1),
          this.astToNodeInfo(whileNode.body, depth + 1),
        ];
        break;

      case 'SwitchStatement':
        const switchNode = node as t.SwitchStatement;
        info.children.push(this.astToNodeInfo(switchNode.discriminant, depth + 1));
        switchNode.cases.forEach(c => {
          info.children.push(this.astToNodeInfo(c, depth + 1));
        });
        break;

      case 'SwitchCase':
        const caseNode = node as t.SwitchCase;
        if (caseNode.test) {
          info.children.push(this.astToNodeInfo(caseNode.test, depth + 1));
        }
        caseNode.consequent.forEach(stmt => {
          info.children.push(this.astToNodeInfo(stmt, depth + 1));
        });
        break;

      case 'TryStatement':
        const tryNode = node as t.TryStatement;
        info.children.push(this.astToNodeInfo(tryNode.block, depth + 1));
        if (tryNode.handler) {
          info.children.push(this.astToNodeInfo(tryNode.handler, depth + 1));
        }
        if (tryNode.finalizer) {
          info.children.push(this.astToNodeInfo(tryNode.finalizer, depth + 1));
        }
        break;

      // === 返回语句 ===
      case 'ReturnStatement':
        const returnNode = node as t.ReturnStatement;
        if (returnNode.argument) {
          info.children.push(this.astToNodeInfo(returnNode.argument, depth + 1));
        }
        break;

      // === 导入导出 ===
      case 'ImportDeclaration':
        const importNode = node as t.ImportDeclaration;
        // 保留模块名
        info.value = this.config.generalizeLiterals ? '_MODULE_' : importNode.source.value;
        // 导入的数量
        info.children.push({
          type: 'ImportCount',
          value: String(importNode.specifiers.length),
          children: [],
        });
        break;

      case 'ExportDefaultDeclaration':
      case 'ExportNamedDeclaration':
        const exportNode = node as t.ExportDefaultDeclaration | t.ExportNamedDeclaration;
        if (exportNode.declaration) {
          info.children.push(this.astToNodeInfo(exportNode.declaration, depth + 1));
        }
        break;

      // === 数组/对象 ===
      case 'ArrayExpression':
        const arrNode = node as t.ArrayExpression;
        info.value = `len:${arrNode.elements.length}`;
        arrNode.elements.forEach(elem => {
          if (elem) {
            info.children.push(this.astToNodeInfo(elem, depth + 1));
          }
        });
        break;

      case 'ObjectExpression':
        const objNode = node as t.ObjectExpression;
        info.value = `props:${objNode.properties.length}`;
        objNode.properties.forEach(prop => {
          info.children.push(this.astToNodeInfo(prop, depth + 1));
        });
        break;

      case 'ObjectProperty':
        const propNode = node as t.ObjectProperty;
        info.children = [
          this.astToNodeInfo(propNode.key, depth + 1),
          this.astToNodeInfo(propNode.value, depth + 1),
        ];
        break;

      // === 块语句 ===
      case 'BlockStatement':
        const blockNode = node as t.BlockStatement;
        blockNode.body.forEach(stmt => {
          info.children.push(this.astToNodeInfo(stmt, depth + 1));
        });
        break;

      case 'Program':
        const programNode = node as t.Program;
        programNode.body.forEach(stmt => {
          info.children.push(this.astToNodeInfo(stmt, depth + 1));
        });
        break;

      // === 表达式语句 ===
      case 'ExpressionStatement':
        const exprStmtNode = node as t.ExpressionStatement;
        info.children.push(this.astToNodeInfo(exprStmtNode.expression, depth + 1));
        break;

      // === 其他：递归处理所有子节点 ===
      default:
        // 尝试处理通用情况
        for (const key of Object.keys(node)) {
          if (key === 'type' || key === 'loc' || key === 'start' || key === 'end' || 
              key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') {
            continue;
          }
          const value = (node as any)[key];
          if (t.isNode(value)) {
            info.children.push(this.astToNodeInfo(value, depth + 1));
          } else if (Array.isArray(value)) {
            value.forEach(item => {
              if (t.isNode(item)) {
                info.children.push(this.astToNodeInfo(item, depth + 1));
              }
            });
          }
        }
    }

    // 如果配置为忽略顺序，对子节点排序
    if (this.config.ignoreOrder && info.children.length > 0) {
      info.children.sort((a, b) => {
        const aStr = this.nodeInfoToSBT(a);
        const bStr = this.nodeInfoToSBT(b);
        return aStr.localeCompare(bStr);
      });
    }

    return info;
  }

  /**
   * 将 NodeInfo 转换为 SBT 字符串
   * 格式: ( Type[Value] child1 child2 ... )
   */
  private nodeInfoToSBT(info: ASTNodeInfo): string {
    let result = `( ${info.type}`;
    
    if (info.value) {
      result += `[${info.value}]`;
    }
    
    if (info.children.length > 0) {
      const childStrings = info.children.map(child => this.nodeInfoToSBT(child));
      result += ' ' + childStrings.join(' ');
    }
    
    result += ' )';
    return result;
  }
}

/**
 * 导出默认实例
 */
export const astSerializer = new ASTSerializer();

/**
 * 便捷函数：序列化代码为 SBT
 */
export function serializeToSBT(code: string, language: string = 'javascript'): string {
  return astSerializer.serialize(code, language);
}

/**
 * 便捷函数：获取 AST 结构
 */
export function getASTStructure(code: string, language: string = 'javascript'): ASTNodeInfo {
  return astSerializer.getStructure(code, language);
}
