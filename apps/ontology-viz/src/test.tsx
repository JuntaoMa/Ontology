import { Graph } from '@antv/g6';

const data = await fetch(
    `${import.meta.env.BASE_URL}npd-v2-ql.g6.json`,
).then((response) => {
    if (!response.ok) {
        throw new Error(`加载失败: ${response.status}`);
    }
    return response.json();
});

type GestureEvent = {
    ctrlKey?: boolean;
};

const isPinchGesture = (event: GestureEvent) =>
    event.ctrlKey === true;


// 创建图实例
const graph = new Graph({
    // 基础配置
    container: 'container',
    autoResize: true,

    // 视口配置
    autoFit: 'center',

    // 主题配置
    theme: 'dark',

    // 节点配置
    node: {
        style: {
            size: 30,
            lineWidth: 2,
        },
    },

    // 边配置
    edge: {
        style: {
            lineWidth: 1.5,
            endArrow: true,
        },
    },

    // 布局配置
    layout: {
        type: "force-atlas2",
        animation: false,
        preventOverlap: true,
    },

    // 交互行为
    behaviors: [// 鼠标按住画布拖拽
        {
            type: "drag-canvas",
            key: "drag-canvas",
        },

        // 触控板双指捏合：缩放
        {
            type: "zoom-canvas",
            key: "pinch-zoom",
            enable: isPinchGesture,
            animation: false,
            sensitivity: 0.8,
            preventDefault: true,
        },

        // 触控板双指平移：移动画布
        {
            type: "scroll-canvas",
            key: "trackpad-pan",
            enable: (event: GestureEvent) => !isPinchGesture(event),
            sensitivity: 1,
            range: Infinity,
            preventDefault: true,
        },
        "drag-element",
    ],

    // 初始数据
    data: data,
});

// 渲染图
graph.render();