import { AbstractParser, EnclosingContext } from "../../constants";
import * as Parser from "tree-sitter";
import * as Python from "tree-sitter-python";

export class PythonParser implements AbstractParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Python);
  }

  findEnclosingContext(
    file: string,
    lineStart: number,
    lineEnd: number
  ): EnclosingContext {
    try {
      const tree = this.parser.parse(file);
      let largestEnclosingContext: Parser.SyntaxNode | null = null;
      let largestSize = 0;

      const processNode = (
        node: Parser.SyntaxNode,
        lineStart: number,
        lineEnd: number,
        currentLargestSize: number,
        currentLargestContext: Parser.SyntaxNode | null
      ): {
        largestSize: number;
        largestEnclosingContext: Parser.SyntaxNode | null;
      } => {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;

        if (startLine <= lineStart && lineEnd <= endLine) {
          const size = endLine - startLine;
          if (size > currentLargestSize) {
            return {
              largestSize: size,
              largestEnclosingContext: node,
            };
          }
        }

        return {
          largestSize: currentLargestSize,
          largestEnclosingContext: currentLargestContext,
        };
      };

      // Traverse the syntax tree
      const cursor = tree.walk();

      const visitNode = () => {
        const node = cursor.currentNode; // Access as a property

        // Look for function definitions and class definitions
        if (
          node.type === "function_definition" ||
          node.type === "class_definition"
        ) {
          const result = processNode(
            node,
            lineStart,
            lineEnd,
            largestSize,
            largestEnclosingContext
          );
          largestSize = result.largestSize;
          largestEnclosingContext = result.largestEnclosingContext;
        }

        // First try to visit children
        if (cursor.gotoFirstChild()) {
          do {
            visitNode();
          } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
      };

      visitNode();

      return {
        enclosingContext: largestEnclosingContext,
      } as EnclosingContext;
    } catch (error) {
      console.error("Error parsing Python file:", error);
      return null;
    }
  }

  dryRun(file: string): { valid: boolean; error: string } {
    try {
      const tree = this.parser.parse(file);
      const hasErrors = tree.rootNode.hasError; // Access as a property, not a method
      return {
        valid: !hasErrors,
        error: hasErrors ? "Syntax error in Python code" : "",
      };
    } catch (error) {
      return {
        valid: false,
        error: error.toString(),
      };
    }
  }
}
