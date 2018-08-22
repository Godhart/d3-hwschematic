import * as d3 from "d3";
import {addMarkers} from "./markers"; 
import {NodeRenderers} from "./node_renderers/selector"; 
import {OperatorNodeRenderer} from "./node_renderers/operatorNode"; 
import {MuxNodeRenderer} from "./node_renderers/muxNode";
import {SliceNodeRenderer} from "./node_renderers/sliceNode";
import {AbstractNodeRenderer} from "./node_renderers/abstract"; 
import {renderLinks} from "./linkRenderer";
import {Tooltip} from "./tooltip";
import {applyHideChildren, hyperEdgesToEdges} from "./dataPrepare";
import {default as d3elk} from "./elk/elk-d3";

function getNameOfEdge(e) {
    var name = "<tspan>unnamed</tspan>";
    if (e.hwt) {
       if (typeof e.hwt.name === "undefined") {
           var p = e.hwt.parent;
           var pIsHyperedge = typeof p.sources !== "undefined"
           if (pIsHyperedge && p.hwt) {
               name = p.hwt.name;
           }
       } else {
           name = e.hwt.name;
       }
    }
    return name;
}

/**
 * HwScheme builds scheme diagrams after bindData(data) is called
 * 
 * @param svg: root svg element where scheme will be rendered
 * @attention zoom is not applied it is only used for focusing on objects
 * @note do specify size of svg to have optimal result
 */
export default class HwSchematic {
    constructor(svg) {
        this.svg = svg;
        this.PORT_PIN_SIZE = [7, 13];
        this.PORT_HEIGHT = this.PORT_PIN_SIZE[1];
        this.CHAR_WIDTH = 7.55;
        this.CHAR_HEIGHT = 13;
        this.NODE_MIDDLE_PORT_SPACING = 20;
        this.MAX_NODE_BODY_TEXT_SIZE = [400, 400];
        // top, right, bottom, left
        this.BODY_TEXT_PADDING = [15, 10, 0, 10];
        this.tooltip = document.getElem
        this.defs = svg.append("defs");
        this.root = svg.append("g");
        this.layouter = new d3elk();
        this.layouter.options({
            edgeRouting: "ORTHOGONAL",
        });
        this.layouter.transformGroup(this.root);
        this.tooltip = new Tooltip(document.getElementsByTagName('body')[0]);
        this.nodeRenderers = new NodeRenderers();

        addMarkers(this.defs, this.PORT_PIN_SIZE);
        this.nodeRenderers.registerRenderer(new OperatorNodeRenderer(this));
        this.nodeRenderers.registerRenderer(new MuxNodeRenderer(this));
        this.nodeRenderers.registerRenderer(new SliceNodeRenderer(this));
        this.nodeRenderers.registerRenderer(new AbstractNodeRenderer(this));
    }

    getHtmlIdOfNode(node) {
        return "node-id-" + node.id;
    }
    
    widthOfText(text) {
        if (text) {
            return text.length * this.CHAR_WIDTH;
        } else {
            return 0;
        }
    }
    
    /**
     * Get parent of node
     * 
     * @attention this methods expect that node.id is string of number which is DFS order
     * */
    getParentOfNode(node) {
        var target = parseInt(node.id);
        var root = this.layouter.kgraph();
        
        while(true) {
           var ch = root.children;
           var i = undefined;
           var found = false;

           ch.some(function (d, _i) {
               if (parseInt(d.id) >= target) {
                   found = d.id === node.id;
                   i = _i;
                   return true;
               }
               return false;
           });

           if (ch.length == 0 || typeof i === "undefined")
               throw new Error("Can not find parent of node, because can not find node in graph node.id=" + node.id + ")");

           if (found) {
               return root;
           } else {
               // use last child with lower ID as potential parent;
               root = ch[i - 1];
           }
        }
    }

    removeGraph() {
      this.root.selectAll("*").remove();
    }

    
    /**
     * Set bind graph data to graph rendering engine
     * 
     * @return promise for this job
     */
    bindData(graph) {
        this.removeGraph();
        hyperEdgesToEdges(graph, graph.hwt.maxId);
        applyHideChildren(graph);
        var root = this.root;
        var layouter = this.layouter;
        var bindData = this.bindData.bind(this);
        var getHtmlIdOfNode = this.getHtmlIdOfNode.bind(this);
        var getParentOfNode = this.getParentOfNode.bind(this);
        var nodeRenderers = this.nodeRenderers
        var schematic = this;

        // config of layouter
        layouter
          .kgraph(graph)
          .size([width, height]);

        var nodes = layouter.getNodes().slice(1); // skip root node
        var edges = layouter.getEdges();
        // nodes are ordered, childeren at the end
        nodes.forEach(nodeRenderers.prepare.bind(nodeRenderers));
      
        return layouter.start().then(function applyLayout() {
          // by "g" we group nodes along with their ports
          var node = root.selectAll(".node")
              .data(nodes)
              .enter()
              .append("g")
              .attr("id", getHtmlIdOfNode);
          nodeRenderers.render(root, node);              
          
          function toggleHideChildren(node) {
              node.hideChildren = !node.hideChildren;
          }
    
          node.on("click", function (d) {
              var children;
              var nextFocusTarget;
              if (d.hideChildren) {
                  // children are hidden, will expand
                  children = d.__children;
                  nextFocusTarget = d;
              } else {
                  // children are visible, will collapse
                  children = d.children;
                  nextFocusTarget = getParentOfNode(d);
              }

              if (!children || children.length == 0)
                  return; // does not have anything to expand

              var graph = layouter.kgraph()
              layouter.cleanLayout();
              root.selectAll("*").remove();
              toggleHideChildren(d); 

              bindData(graph).then(function() {
                 layouter.zoomToFit(nextFocusTarget);
              });
          });

          var [link, linkWrap, junctionPoint] = renderLinks(root, edges);
          linkWrap.on("mouseover", function (d) {
              d3.select(this)
                .attr("class", "link-wrap-activated");

              schematic.tooltip.show(d3.event, getNameOfEdge(d));
          });
          linkWrap.on("mouseout", function (d) {
              d3.select(this)
                .attr("class", "link-wrap");
              schematic.tooltip.hide();
          });
          
          function onLinkClick(d) {
              var doSelect = !d.selected;
              var l = d3.select(this);
              var data = l.data()[0];
              // propagate click on all nets with same source
              var src = data.source;
              var srcP = data.sourcePort;
              link.classed("link-selected", function (d) {
                  if (d.source == src && d.sourcePort == srcP) {
                      d.selected = doSelect;
                  }
                  return d.selected;
              });
              d3.event.stopPropagation();
            }
          
          // Select net on click
          link.on("click", onLinkClick);
          linkWrap.on("click", onLinkClick);
        });
    }
    terminate() {
      if (this.layouter)
        this.layouter.terminate();
    }
}
