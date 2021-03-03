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

      proxy.getDefinitionAndBoundSpan = (fileName, position) => {
        const existing = info.languageService.getDefinitionAndBoundSpan(fileName, position)
        const definition = existing?.definitions?.[0]
        if (!definition) return existing
        const program = info.languageService.getProgram()
        if (!program) return existing
        const sourceFile = program.getSourceFile(fileName)
        if (!sourceFile) return existing
        const definitionStart = definition.textSpan.start
        const definitionEnd = definition.textSpan.start + definition.textSpan.length
        const findEnclosingNode = (node: ts.Node) => node.forEachChild((childNode) => {
          if (childNode.getStart() <= definitionStart && definitionEnd <= childNode.getEnd()) return childNode
        })
        const expectedEnclosingNodeSyntaxKinds: ts.SyntaxKind[] = [
          ts.SyntaxKind.VariableStatement,
          ts.SyntaxKind.VariableDeclarationList,
          ts.SyntaxKind.VariableDeclaration,
          ts.SyntaxKind.CallExpression,
        ]
        let enclosingNode: ts.Node | undefined = sourceFile
        for (const expectedEnclosingNodeSyntaxKind of expectedEnclosingNodeSyntaxKinds) {
          enclosingNode = findEnclosingNode(enclosingNode)
          if (!enclosingNode) return existing
          log(`found ${enclosingNode.kind}: ${enclosingNode.getStart()}-${enclosingNode.getEnd()}`)
          if (enclosingNode.kind !== expectedEnclosingNodeSyntaxKind) return existing
        }
        const enclosingFlowMaxNode = enclosingNode as ts.CallExpression
        if (enclosingFlowMaxNode.expression.kind !== ts.SyntaxKind.Identifier || (enclosingFlowMaxNode.expression as ts.Identifier).escapedText !== 'flowMax') return existing
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
          if (!firstParam.valueDeclaration) return
          const firstParamType = typeChecker.getTypeOfSymbolAtLocation(firstParam, firstParam.valueDeclaration)
          // log(`found first param type: ${typeChecker.typeToString(firstParamType)}`)
          const firstParamTypeProperties = firstParamType.getProperties()
          // log(`found definition name: ${definition.name}`)
          const found = firstParamTypeProperties.find(property => property.name === definition.name)
          if (!found) {
            log(`found not found`)
            return {
              definitions: [
                {
                  fileName,
                  textSpan: {
                    start: currentChainStepNode.pos + 1,
                    length: currentChainStepNode.end - currentChainStepNode.pos,
                  },
                  kind: ts.ScriptElementKind.unknown,
                  name: definition.name,
                  containerKind: ts.ScriptElementKind.unknown,
                  containerName: definition.name,
                }
              ],
              textSpan: existing!.textSpan,
            }
          } else {
            log(`found found`)
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
