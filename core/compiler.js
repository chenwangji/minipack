const path = require('path')
const fs = require('fs')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generator = require('@babel/generator').default
const t = require('@babel/types')
const { SyncHook } = require('tapable')
const { toUnixPath, tryExtensions, getSourceCode } = require('./utils/index')


// Compiler 类进行核心编译实现
class Compiler {
    constructor(options) {
        this.options = options

        // 创建 plugin hooks
        this.hooks = {
            // 开始编译时的钩子
            run: new SyncHook(),
            // 输出 asset 到 output 目录之前执行（写入文件之前）
            emit: new SyncHook(),
            // 在 compilation 完成时之行，全部完成编译执行
            done: new SyncHook()
        }

        // 保存所有的入口模块对象
        this.entries = new Set()
        // 保存所有的依赖模块对象
        this.modules = new Set()
        // 所有的代码块对象
        this.chunks = new Set()
        // 存放本次产出的文件对象
        this.assets = {}
        // 存放本次编译所有产出的文件名
        this.files = new Set()

        // 根路径
        this.rootPath = this.options.context || toUnixPath(process.cwd())

        this.moduleCode = ''

        this.originSourceCode = ''
    }

    // run 方法启动编译
    // 同时 run 方法接受外部传递的 callback
    run(callback) {
        // 当调用 run 方法时，触发开始编译的 plugin
        this.hooks.run.call()
        // 获取入口配置对象
        const entry = this.getEntry()
        // 编译入口文件
        this.buildEntryModule(entry)
        // 导出列表，之后将每个 chunk 转化成为单独的文件加入到输出列表 assets 中
        this.exportFile(callback)
    }

    // 获取入口文件路径
    getEntry() {
        let entry = Object.create(null)
        const { entry: optionsEntry } = this.options

        if (typeof optionsEntry === 'string') {
            entry.main = optionsEntry
        } else {
            entry = optionsEntry
        }

        // 将 entry 变成绝对路径
        Object.keys(entry).forEach(key => {
            const value = entry[key]
            if (!path.isAbsolute(value)) {
                // 转化为绝对路径的同时统一路径分隔符卫 /
                entry[key] = toUnixPath(path.join(this.rootPath, value))
            }
        })

        return entry
    }

    buildEntryModule(entry) {
        Object.keys(entry).forEach(entryName => {
            const entryPath = entry[entryName]
            // 调用 buildModule 实现真正的模块编译逻辑
            const entryObj = this.buildModule(entryName, entryPath)
            this.entries.add(entryObj)

            // 根据当前入口文件和模块的相互依赖关系，组装成为一个个包含当前入口所有依赖模块的 chunk
            this.buildUpChunk(entryName, entryObj)
        })

        // console.log(this.entries, 'entries')
        // console.log(this.modules, 'modules')
        // console.log(this.chunks, 'chunks')
    }

    // 模块编译方法
    buildModule(moduleName, modulePath) {
        // 1.读取文件原始代码
        const originSourceCode = this.originSourceCode = fs.readFileSync(modulePath, 'utf-8')
        // moduleCode 为修改后的代码
        this.moduleCode = originSourceCode
        // 2.调用 loader 进行处理
        this.handleLoder(modulePath)
        // 3.调用 webpack 进行模块编译 获得最终的 
        const module = this.handleWebpackCompiler(moduleName, modulePath)
        // 4.返回对应 module
        return module
    }

    // 匹配 loader 处理
    handleLoder(modulePath) {
        const matchLoaders = []
        // 1.获取所有传入的 loader 规则
        const rules = this.options.module.rules
        
        rules.forEach(loader => {
            const testRule = loader.test
            if (testRule.test(modulePath)) {
                // 匹配 { test: /\js$/, loader: path.resolve(__dirname, '../loaders/loader-1.js') }
                if (loader.loader) {
                    matchLoaders.push(loader.loader)
                } else {
                    matchLoaders.push(...loader.use)
                }
            }
        })

        // 2.倒叙执行 loader 传入的代码
        for (let i = matchLoaders.length - 1; i >= 0; i--) {
            // 仅实现绝对路径的自定义 loader 模式
            // require 引入对应的 loader
            const loaderFn = require(matchLoaders[i])
            // 通过 loader 同步处理每一次编译的 moduleCode
            this.moduleCode = loaderFn(this.moduleCode)
        }
    }

    handleWebpackCompiler(moduleName, modulePath) {
        // 将当前模块相对于项目启动根目录计算出的相对路径作为模块 ID
        const moduleId = './' + path.posix.relative(this.rootPath, modulePath)
        // 创建模块对象
        const module = {
            id: moduleId,
            dependencies: new Set(), // 该模块所依赖模块的绝对路径地址
            name: [moduleName] // 该模块所属的入口文件
        }

        // 调用 babel 分析我们的代码
        const ast = parser.parse(this.moduleCode, {
            sourceType: 'module'
        })

        // 深度优先，遍历语法树
        traverse(ast, {
            // 当遇到 require 语句时
            CallExpression: nodePath => {
                const node = nodePath.node
                if (node.callee.name === 'require') {
                    // 获取源代码中引入模块相对路径
                    const requirePath = node.arguments[0].value
                    // 寻找模块绝对路径  当前模块路径+require() 对应相对路径
                    const moduleDirName = path.posix.dirname(modulePath)
                    const absolutePath = tryExtensions(
                        path.posix.join(moduleDirName, requirePath),
                        this.options.resolve.extensions,
                        requirePath,
                        moduleDirName
                    )

                    // 生成 moduleId - 相对于根路径的模块 ID  添加进入新的依赖模块路径
                    const moduleId = './' + path.posix.relative(this.rootPath, absolutePath)

                    // 通过 babel 修改源代码中的 require 变成 __webpack_require__ 语句
                    node.callee = t.identifier('__webpack_require__')
                    // 修改源代码中 require 语句引入的模块，全部修改为相对于根路径的模块 ID
                    node.arguments = [t.stringLiteral(moduleId)]

                    // 如果 modules 已经存在相同 ID 的模块，则不添加
                    const alreadyModules = Array.from(this.modules).map(m => m.id)
                    if (!alreadyModules.includes(moduleId)) {
                        // 为当前模块添加 require 语句造成的依赖（内容为相对根路径的模块 ID）
                        module.dependencies.add(moduleId)
                    } else {
                        // 已经存在的话，虽然不进行添加进入模块编译，但是仍要更新这个模块依赖的入口
                        this.modules.forEach(m => {
                            if (m.id === moduleId) {
                                m.name.push(moduleName)
                            }
                        })
                    }
                    
                }
            }
        })

        // 遍历结束根据 AST 生成新的代码
        const { code } = generator(ast)
        // 为当前模块挂载新的生成的代码
        module._source = code

        // 递归依赖深度遍历，存在依赖模块则加入
        module.dependencies.forEach(dependency => {
            const depModule = this.buildModule(moduleName, dependency)
            // 将编译后的任何依赖模块对象加入到 modules 对象中去
            this.modules.add(depModule)
        })
        // 返回当前模块对象
        return module
    }

    // 根据入口文件和依赖模块组装 chunks
    buildUpChunk(entryName, entryObj) {
        const chunk = {
            name: entryName, // 每一个入口文件作为一个 chunk
            entryModule: entryObj, // entry 编译后的对象
            modules: Array.from(this.modules).filter(i => i.name.includes(entryName)), // 寻找与当前 entry 有关的所有 module
        }

        this.chunks.add(chunk)
    }

    // 将 chunk 加入输出列表中去
    exportFile(callback) {
        const {output} = this.options
        // 根据 chunks 生成 assets 内容 
        this.chunks.forEach(chunk => {
            const parsedFileName = output.filename.replace('[name]', chunk.name)
            // assets 中 { 'main.js': '生成的字符串代码' }
            this.assets[parsedFileName] = getSourceCode(chunk)
        })

        // 调用 plugin emit 钩子
        this.hooks.emit.call()

        // 先判断目录是否存在，存在直接 fs.write, 不存在则首先创建
        if (!fs.existsSync(output.path)) {
            fs.mkdirSync(output.path)
        }
        
        // files 中保存所有生成的文件名
        this.files = Object.keys(this.assets)

        // 将 assets 中的内容生成打包文件，写入文件系统
        Object.keys(this.assets).forEach(fileName => {
            const filePath = path.join(output.path, fileName)
            fs.writeFileSync(filePath, this.assets[fileName])
        })

        // 结束之后触发狗子
        this.hooks.done.call()
        
        callback(null, {
            toJson: () => {
                return {
                    entries: this.entries,
                    modules: this.modules,
                    files: this.files,
                    chunks: this.chunks,
                    assets: this.assets
                }
            }
        })
    }
}

module.exports = Compiler