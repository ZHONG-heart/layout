/**
 * @fileOverview random layout
 * @author shiwu.wyy@antfin.com
 */

import { Edge, Model, PointTuple, ForceLayoutOptions } from "../types";
import * as d3Force from "d3-force";
import forceInABox from "./force-in-a-box";
import { isArray, isFunction, isNumber } from "../../util";
import { Base } from "../base";
import { LAYOUT_MESSAGE } from "../constants";

/**
 * 经典力导布局 force-directed
 */
export class ForceLayout extends Base {
  /** 向心力作用点 */
  public center: PointTuple = [0, 0];

  /** 节点作用力 */
  public nodeStrength: number | null = null;

  /** 边的作用力, 默认为根据节点的入度出度自适应 */
  public edgeStrength: number | null = null;

  /** 是否防止节点相互覆盖 */
  public preventOverlap: boolean = false;

  /** 节点大小 / 直径，用于防止重叠时的碰撞检测 */
  public nodeSize: number | number[] | ((d?: unknown) => number) | undefined;

  /** 节点间距，防止节点重叠时节点之间的最小距离（两节点边缘最短距离） */
  public nodeSpacing: ((d?: unknown) => number) | undefined;

  /** 是否支持按类聚合 */
  public clustering: boolean;

  /** 聚类节点作用力 */
  public clusterNodeStrength: number | null = null;

  /** 聚类边作用力 */
  public clusterEdgeStrength: number | null = null;

  /** 聚类边长度 */
  public clusterEdgeDistance: number | null = null;

  /** 聚类节点大小 / 直径，直径越大，越分散 */
  public clusterNodeSize: number | null = null;

  /** 用于 foci 的力 */
  public clusterFociStrength: number | null = null;

  /** 默认边长度 */
  public linkDistance: number = 50;

  /** 自定义 force 方法 */
  public forceSimulation: any;

  /** 迭代阈值的衰减率 [0, 1]，0.028 对应最大迭代数为 300 */
  public alphaDecay: number = 0.028;

  /** 停止迭代的阈值 */
  public alphaMin: number = 0.001;

  /** 当前阈值 */
  public alpha: number = 0.3;

  /** 防止重叠的力强度 */
  public collideStrength: number = 1;

  /** 是否启用web worker。前提是在web worker里执行布局，否则无效	*/
  public workerEnabled: boolean = false;

  public tick: () => void = () => {};

  /** 布局完成回调 */
  public onLayoutEnd: () => void = () => {};

  /** 是否正在布局 */
  private ticking: boolean | undefined = undefined;

  private edgeForce: any;

  private clusterForce: any;

  constructor(options?: ForceLayoutOptions) {
    super();
    if (options) {
      this.updateCfg(options);
    }
  }

  public getDefaultCfg() {
    return {
      center: [0, 0],
      nodeStrength: null,
      edgeStrength: null,
      preventOverlap: false,
      nodeSize: undefined,
      nodeSpacing: undefined,
      linkDistance: 50,
      forceSimulation: null,
      alphaDecay: 0.028,
      alphaMin: 0.001,
      alpha: 0.3,
      collideStrength: 1,
      clustering: false,
      clusterNodeStrength: -1,
      clusterEdgeStrength: 0.1,
      clusterEdgeDistance: 100,
      clusterFociStrength: 0.8,
      clusterNodeSize: 10,
      tick() {},
      onLayoutEnd() {}, // 布局完成回调
      // 是否启用web worker。前提是在web worker里执行布局，否则无效
      workerEnabled: false
    };
  }

  /**
   * 初始化
   * @param {object} data 数据
   */
  public init(data: Model) {
    const self = this;
    self.nodes = data.nodes || [];
    const edges = data.edges || [];
    self.edges = edges.map(edge => {
      const res: any = {};
      const expectKeys = ["targetNode", "sourceNode", "startPoint", "endPoint"];
      Object.keys(edge).forEach((key: keyof Edge) => {
        if (!(expectKeys.indexOf(key) > -1)) {
          res[key] = edge[key];
        }
      });
      return res;
    });
    self.ticking = false;
  }

  /**
   * 执行布局
   */
  public execute(reloadData?: boolean) {
    const self = this;
    const nodes = self.nodes;
    const edges = self.edges;
    // 如果正在布局，忽略布局请求
    if (self.ticking) {
      return;
    }
    let simulation = self.forceSimulation;
    const alphaMin = self.alphaMin;
    const alphaDecay = self.alphaDecay;
    const alpha = self.alpha;
    if (!simulation) {
      try {
        // 定义节点的力
        const nodeForce = d3Force.forceManyBody();
        if (self.nodeStrength) {
          nodeForce.strength(self.nodeStrength);
        }
        simulation = d3Force.forceSimulation().nodes(nodes as any);

        if (self.clustering) {
          const clusterForce = forceInABox() as any;
          clusterForce
            .centerX(self.center[0])
            .centerY(self.center[1])
            .template("force")
            .strength(self.clusterFociStrength);
          if (edges) {
            clusterForce.links(edges);
          }
          if (nodes) {
            clusterForce.nodes(nodes);
          }
          clusterForce
            .forceLinkDistance(self.clusterEdgeDistance)
            .forceLinkStrength(self.clusterEdgeStrength)
            .forceCharge(self.clusterNodeStrength)
            .forceNodeSize(self.clusterNodeSize);

          self.clusterForce = clusterForce;
          simulation.force("group", clusterForce);
        }
        simulation
          .force("center", d3Force.forceCenter(self.center[0], self.center[1]))
          .force("charge", nodeForce)
          .alpha(alpha)
          .alphaDecay(alphaDecay)
          .alphaMin(alphaMin);

        if (self.preventOverlap) {
          self.overlapProcess(simulation);
        }
        // 如果有边，定义边的力
        if (edges) {
          // d3 的 forceLayout 会重新生成边的数据模型，为了避免污染源数据
          const edgeForce = d3Force
            .forceLink()
            .id((d: any) => d.id)
            .links(edges);
          if (self.edgeStrength) {
            edgeForce.strength(self.edgeStrength);
          }
          if (self.linkDistance) {
            edgeForce.distance(self.linkDistance);
          }
          self.edgeForce = edgeForce;
          simulation.force("link", edgeForce);
        }
        if (self.workerEnabled && !isInWorker()) {
          // 如果不是运行在web worker里，不用web worker布局
          self.workerEnabled = false;
          console.warn(
            "workerEnabled option is only supported when running in web worker."
          );
        }
        if (!self.workerEnabled) {
          simulation
            .on("tick", () => {
              self.tick();
            })
            .on("end", () => {
              self.ticking = false;
              if (self.onLayoutEnd) self.onLayoutEnd();
            });
          self.ticking = true;
        } else {
          // worker is enabled
          simulation.stop();
          const totalTicks = getSimulationTicks(simulation);
          for (let currentTick = 1; currentTick <= totalTicks; currentTick++) {
            simulation.tick();
            // currentTick starts from 1.
            postMessage(
              {
                nodes,
                currentTick,
                totalTicks,
                type: LAYOUT_MESSAGE.TICK
              },
              undefined as any
            );
          }
          self.ticking = false;
        }

        self.forceSimulation = simulation;
        self.ticking = true;
      } catch (e) {
        self.ticking = false;
        console.warn(e);
      }
    } else {
      if (reloadData) {
        if (self.clustering && self.clusterForce) {
          self.clusterForce.nodes(nodes);
          self.clusterForce.links(edges);
        }
        simulation.nodes(nodes);
        if (edges && self.edgeForce) self.edgeForce.links(edges);
        else if (edges && !self.edgeForce) {
          // d3 的 forceLayout 会重新生成边的数据模型，为了避免污染源数据
          const edgeForce = d3Force
            .forceLink()
            .id((d: any) => d.id)
            .links(edges);
          if (self.edgeStrength) {
            edgeForce.strength(self.edgeStrength);
          }
          if (self.linkDistance) {
            edgeForce.distance(self.linkDistance);
          }
          self.edgeForce = edgeForce;
          simulation.force("link", edgeForce);
        }
      }
      if (self.preventOverlap) {
        self.overlapProcess(simulation);
      }
      simulation.alpha(alpha).restart();
      this.ticking = true;
    }
  }

  /**
   * 防止重叠
   * @param {object} simulation 力模拟模型
   */
  public overlapProcess(simulation: any) {
    const self = this;
    const nodeSize = self.nodeSize;
    const nodeSpacing = self.nodeSpacing;
    let nodeSizeFunc: (d: any) => number;
    let nodeSpacingFunc: any;
    const collideStrength = self.collideStrength;

    if (isNumber(nodeSpacing)) {
      nodeSpacingFunc = () => nodeSpacing;
    } else if (isFunction(nodeSpacing)) {
      nodeSpacingFunc = nodeSpacing;
    } else {
      nodeSpacingFunc = () => 0;
    }

    if (!nodeSize) {
      nodeSizeFunc = d => {
        if (d.size) {
          if (isArray(d.size)) {
            const res = d.size[0] > d.size[1] ? d.size[0] : d.size[1];
            return res / 2 + nodeSpacingFunc(d);
          }
          return d.size / 2 + nodeSpacingFunc(d);
        }
        return 10 + nodeSpacingFunc(d);
      };
    } else if (isFunction(nodeSize)) {
      nodeSizeFunc = d => {
        const size = nodeSize(d);
        return size + nodeSpacingFunc(d);
      };
    } else if (isArray(nodeSize)) {
      const larger = nodeSize[0] > nodeSize[1] ? nodeSize[0] : nodeSize[1];
      const radius = larger / 2;
      nodeSizeFunc = d => radius + nodeSpacingFunc(d);
    } else if (isNumber(nodeSize)) {
      const radius = nodeSize / 2;
      nodeSizeFunc = d => radius + nodeSpacingFunc(d);
    } else {
      nodeSizeFunc = () => 10;
    }

    // forceCollide's parameter is a radius
    simulation.force(
      "collisionForce",
      d3Force.forceCollide(nodeSizeFunc).strength(collideStrength)
    );
  }

  /**
   * 更新布局配置，但不执行布局
   * @param {object} cfg 需要更新的配置项
   */
  public updateCfg(cfg: ForceLayoutOptions) {
    const self = this;
    if (self.ticking) {
      self.forceSimulation.stop();
      self.ticking = false;
    }
    self.forceSimulation = null;
    Object.assign(self, cfg);
  }

  public destroy() {
    const self = this;
    if (self.ticking) {
      self.forceSimulation.stop();
      self.ticking = false;
    }
    self.nodes = null;
    self.edges = null;
    self.destroyed = true;
  }
}

// Return total ticks of d3-force simulation
function getSimulationTicks(simulation: any): number {
  const alphaMin = simulation.alphaMin();
  const alphaTarget = simulation.alphaTarget();
  const alpha = simulation.alpha();
  const totalTicksFloat =
    Math.log((alphaMin - alphaTarget) / (alpha - alphaTarget)) /
    Math.log(1 - simulation.alphaDecay());
  const totalTicks = Math.ceil(totalTicksFloat);
  return totalTicks;
}
declare const WorkerGlobalScope: any;

// 判断是否运行在web worker里
function isInWorker(): boolean {
  // eslint-disable-next-line no-undef
  return (
    typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope
  );
}
