const fs = require('fs')

/**
 * 统一路径分隔符 主要是为了后续生成模块 id 方便
 * @param {string} path 
 */
function toUnixPath(path) {
    return path.replace(/\\/, '/')
}

function tryExtensions(
    modulePath,
    extensions,
    originModulePath,
    moduleContext
) {
    extensions.unshift('')
    for (let extension of extensions) {
        if (fs.existsSync(modulePath + extension)) {
            return modulePath + extension
        }
    }

    // 未匹配到对应文件
    throw new Error(
        `No module, Error: Can't resolve ${originModulePath} in ${moduleContext}`
    )
}

/**
 * 根据 chunk 返回对应的代码
 * @param {obj} chunk 
 */
 function getSourceCode(chunk) {
    const { name, entryModule, modules } = chunk;
    return `
    (() => {
      var __webpack_modules__ = {
        ${modules
          .map((module) => {
            return `
            '${module.id}': (module) => {
              ${module._source}
        }
          `;
          })
          .join(',')}
      };
      // The module cache
      var __webpack_module_cache__ = {};
  
      // The require function
      function __webpack_require__(moduleId) {
        // Check if module is in cache
        var cachedModule = __webpack_module_cache__[moduleId];
        if (cachedModule !== undefined) {
          return cachedModule.exports;
        }
        // Create a new module (and put it into the cache)
        var module = (__webpack_module_cache__[moduleId] = {
          // no module.id needed
          // no module.loaded needed
          exports: {},
        });
  
        // Execute the module function
        __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
  
        // Return the exports of the module
        return module.exports;
      }
  
      var __webpack_exports__ = {};
      // This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
      (() => {
        ${entryModule._source}
      })();
    })();
    `;
  }



module.exports = {
    toUnixPath,
    tryExtensions,
    getSourceCode
}