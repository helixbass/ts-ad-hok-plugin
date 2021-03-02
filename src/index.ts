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

      proxy.getDefinitionAndBoundSpan = (fileName, position) => {
        const ret = info.languageService.getDefinitionAndBoundSpan(fileName, position)
        const def = ret!.definitions![0]!
        info.project.projectService.logger.info("Wheeee")
        return info.languageService.getDefinitionAndBoundSpan(fileName, position)
      }

      proxy.getCompletionsAtPosition = (fileName, position, opts) => {
        const prior = info.languageService.getCompletionsAtPosition(fileName, position, opts);
        if (!prior) return prior
        const oldLength = prior.entries.length;
        const whatToRemove = ['caller', 'getDay']
        prior.entries = prior.entries.filter(e => whatToRemove.indexOf(e.name) < 0);

        // Sample logging for diagnostic purposes
        if (oldLength !== prior.entries.length) {
            info.project.projectService.logger.info(`Removed ${oldLength - prior.entries.length} entries from the completion list`);
        }

        return prior;
      };

      return proxy
    }
  }
}

export = init
