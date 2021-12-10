// 插件 B
class PluginB {
    apply(compiler) {
        // 注册同步钩子
        // 这里的 compiler 就是 new Compiler 创建的实例
        compiler.hooks.run.tap('Plugin B', () => {
            // 调用
            console.log('Plugin B')
        })
    }
}

module.exports = PluginB