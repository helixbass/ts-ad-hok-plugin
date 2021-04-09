const init = (modules: {typescript: typeof import('typescript/lib/tsserverlibrary')}) => {
  const ts = modules.typescript

  return {
    create: function(info: ts.server.PluginCreateInfo) {
      const proxy: ts.LanguageService = Object.create(null)
      const oldLanguageService = info.languageService
      for (const key in oldLanguageService) {
        (proxy as any)[key] = function(...args: {}[]) {
          return ((oldLanguageService as any)[key] as any).apply(oldLanguageService, args)
        }
      }

      const log = (message: string) => info.project.projectService.logger.info(message)
      const dump = (obj: any, depth?: number) => require('util').inspect(obj, false, depth)

      const findEnclosingNodeAtPosition = (parentNode: ts.Node, position: number): ts.Node | undefined => parentNode.forEachChild((childNode) => {
        if (childNode.getStart() <= position && position <= childNode.getEnd()) return childNode
      })

      const findIdentifierAndAncestorsAtPosition = (sourceFile: ts.SourceFile, position: number): {
        identifier: ts.Identifier
        ancestors: ts.Node[]
      } | undefined => {
        let currentNode: ts.Node | undefined = sourceFile
        const ancestors: ts.Node[] = []
        while (currentNode) {
          ancestors.push(currentNode)
          if (currentNode.kind === ts.SyntaxKind.Identifier) return {
            identifier: currentNode as ts.Identifier,
            ancestors
          }
          currentNode = findEnclosingNodeAtPosition(currentNode, position)
        }
      }

      proxy.getDefinitionAndBoundSpan = (fileName, position) => {
        const existing = info.languageService.getDefinitionAndBoundSpan(fileName, position)
        // log('found here')
        if (existing) return existing
        // log('found existing')
        const program = info.languageService.getProgram()
        if (!program) return existing
        const sourceFile = program.getSourceFile(fileName)
        if (!sourceFile) return existing
        const queriedIdentifierAndAncestors = findIdentifierAndAncestorsAtPosition(sourceFile, position)
        // log('found pre-queriedIdentifierAndAncestors')
        if (!queriedIdentifierAndAncestors) return existing
        // log('found post-queriedIdentifierAndAncestors')
        const {
          identifier: queriedIdentifier,
          ancestors: queriedIdentifierAncestors
        } = queriedIdentifierAndAncestors
        const expectedQueriedIdentifierAncestorSyntaxKinds: ts.SyntaxKind[] = [
          ts.SyntaxKind.Identifier,
          ts.SyntaxKind.BindingElement,
          ts.SyntaxKind.ObjectBindingPattern,
          ts.SyntaxKind.Parameter,
        ]

        let enclosingQueriedIdentifierAncestorNode: ts.Node | undefined = sourceFile
        // log('found pre-check ancestor kinds')
        for (const expectedAncestorNodeSyntaxKind of expectedQueriedIdentifierAncestorSyntaxKinds) {
          const ancestorNode = queriedIdentifierAncestors.pop()
          if (!ancestorNode) return existing
          if (ancestorNode.kind !== expectedAncestorNodeSyntaxKind) return existing
        }
        // log('found post-check ancestor kinds')
        const expectedEnclosingNodeSyntaxKinds: ts.SyntaxKind[] = [
          ts.SyntaxKind.VariableStatement,
          ts.SyntaxKind.VariableDeclarationList,
          ts.SyntaxKind.VariableDeclaration,
          ts.SyntaxKind.CallExpression,
        ]

        const findEnclosingNode = (node: ts.Node) => node.forEachChild((childNode) => {
          if (childNode.getStart() <= position && position <= childNode.getEnd()) return childNode
        })

        let enclosingNode: ts.Node | undefined = sourceFile
        for (const expectedEnclosingNodeSyntaxKind of expectedEnclosingNodeSyntaxKinds) {
          enclosingNode = findEnclosingNode(enclosingNode)
          if (!enclosingNode) return existing
          // log(`found ${enclosingNode.kind}: ${enclosingNode.getStart()}-${enclosingNode.getEnd()}`)
          if (enclosingNode.kind !== expectedEnclosingNodeSyntaxKind) return existing
        }
        const enclosingFlowMaxNode = enclosingNode as ts.CallExpression
        if (enclosingFlowMaxNode.expression.kind !== ts.SyntaxKind.Identifier || (enclosingFlowMaxNode.expression as ts.Identifier).text !== 'flowMax') return existing
        const enclosingChainStepNode = findEnclosingNode(enclosingFlowMaxNode)
        if (!enclosingChainStepNode) return existing
        let chainStepNodeIndex = enclosingFlowMaxNode.arguments.findIndex(arg => arg === enclosingChainStepNode)
        if (chainStepNodeIndex === -1) return existing
        const typeChecker = program.getTypeChecker()
        let currentChainStepNode
        while (chainStepNodeIndex >= 0) {
          currentChainStepNode = enclosingFlowMaxNode.arguments[chainStepNodeIndex]
          const chainStepType = typeChecker.getTypeAtLocation(currentChainStepNode)
          const signature = chainStepType.getCallSignatures()[0]
          if (!signature) return existing
          const firstParam = signature.getParameters()[0]
          // log(`found first param: ${typeChecker.symbolToString(firstParam)}`)
          if (!firstParam.valueDeclaration) return existing
          const firstParamType = typeChecker.getTypeOfSymbolAtLocation(firstParam, firstParam.valueDeclaration)
          // log(`found first param type: ${typeChecker.typeToString(firstParamType)}`)
          const firstParamTypeProperties = firstParamType.getProperties()
          // log(`found definition name: ${definition.name}`)
          const queriedName = queriedIdentifier.text
          const found = firstParamTypeProperties.find(property => property.name === queriedName)
          if (!found) {
            // log(`found not found`)
            return {
              definitions: [
                {
                  fileName,
                  textSpan: ts.createTextSpan(currentChainStepNode.getStart(), currentChainStepNode.getWidth()),
                  kind: ts.ScriptElementKind.unknown,
                  name: queriedName,
                  containerKind: ts.ScriptElementKind.unknown,
                  containerName: queriedName,
                }
              ],
              textSpan: ts.createTextSpan(queriedIdentifier.getStart(), queriedIdentifier.getWidth()),
            }
          } else {
            // log(`found found`)
          }
          chainStepNodeIndex--
        }
        return existing
      };

      return proxy
    }
  }
}

export = init
