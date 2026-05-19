# MakerWorld Quick Save

这是一个面向 `https://makerworld.com.cn/zh/models/*` 的浏览器插件原型。

当前阶段完成了：

- 识别 MakerWorld 中文站模型详情页
- 从页面 `#__NEXT_DATA__` 中提取结构化信息
- 把模型、作者、图片、打印配置和 plate 信息整理成统一 JSON
- 在插件弹窗中预览解析结果
- 允许用户选择本地保存目录
- 在目录下创建项目文件夹并写入 `metadata.json`
- 下载封面图、横版封面、竖版封面、详情图、实例封面、plate 预览图和作者头像
- 保存评论预览、下载线索和每个打印配置的独立 `instance.json`

## 本地加载

1. 打开 Chrome 或 Edge 的扩展管理页
2. 启用开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择当前目录：

```text
C:\Users\19352\Documents\MakerWorldHelper_CN
```

## 当前数据来源

插件内容脚本会读取页面源码中的 `#__NEXT_DATA__`，而不是直接抓取零散 DOM 文本。

这样做的好处是：

- 字段更全
- 结构更稳定
- 更适合后续保存为 `metadata.json`

## 当前保存结构

```text
模型文件夹/
  metadata.json
  comments-preview.json
  download-hints.json
  save-manifest.json
  source-url.txt
  summary.txt
  creator/
    avatar.jpg
  model/
    files/
    images/
      cover.jpg
      cover-landscape.jpg
      cover-portrait.jpg
      detail-01.jpg
  instances/
    2477300-0.2mm-层高-2-层墙-100%-填充/
      instance.json
      files/
      pictures/
        instance-cover.jpg
      plates/
        plate-1.png
        plate-2.png
```

## 下一步建议

- 增加保存配置页面
- 让用户自定义文件夹命名规则
- 继续分析真实模型文件下载地址
- 如果拿到真实下载接口，再补 `.3mf/.stl/.zip` 自动下载
