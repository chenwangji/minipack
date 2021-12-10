const Compiler = require('./compiler')

function webpack(options) {
    // 合并参数 得到合并后的参数 mergeOptions
    const mergeOptions = _mergeOptions(options);

    // 创建 compiler 对象
    const compiler = new Compiler(mergeOptions)

    // 加载插件，注册事件
    _loadPlugin(options.plugins, compiler)

    return compiler
}

// 合并参数
function _mergeOptions(options) {
    const shellOptions = process.argv.slice(2).reduce((option, argv) => {
        // argv：mode=production key=xxx
        const [key, value] = argv.split('=')
        if (key && value) {
            option[key] = value
        }
        return option
    }, {})

    return {
        ...options,
        ...shellOptions
    }
}

// 加载插件
function _loadPlugin(plugins, compiler) {
    if (plugins && Array.isArray(plugins)) {
        plugins.forEach(plugin => {
            plugin.apply(compiler)
        })
    }
}

module.exports = webpack
