/*******************************************************************************
 * Copyright (c) 2017 Kiel University and others.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v10.html
 *******************************************************************************/
export default class ELK {
  constructor({
    defaultLayoutOptions = {},
    algorithms = [ 'layered', 'stress', 'mrtree', 'radial', 'force', 'disco' ],
    workerFactory,
    workerUrl
    } = {}) {
    this.defaultLayoutOptions = defaultLayoutOptions;
    this.initialized = false;
    this.algorithms = algorithms;
  
    // check valid worker construction possible
    if (typeof workerUrl === 'undefined' && typeof workerFactory === 'undefined') {
      throw new Error("Cannot construct an ELK without both 'workerUrl' and 'workerFactory'.")
    }
    let factory = workerFactory
    if (typeof workerUrl !== 'undefined' && typeof workerFactory === 'undefined') {
      // use default Web Worker
      factory = function(url) { return new Worker(url) }
    }
  
    // create the worker
    let worker = factory(workerUrl)
    if (typeof worker.postMessage !== 'function' ) {
      throw new TypeError("Created worker does not provide"
        + " the required 'postMessage' function.")
    }
  
    // wrap the worker to return promises
    this.worker = new PromisedWorker(worker)
  }
  
  layout(graph, { layoutOptions = this.defaultLayoutOptions } = {}) {
      var self = this;
      function postLayout() {
          if (!graph) {
            return Promise.reject(new Error("Missing mandatory parameter 'graph'."));
          }
          return self.worker.postMessage({
            cmd: 'layout',
            graph: graph,
            options: layoutOptions
          });
      }

      if (!this.initialized) {
        var self = this;
        // initially register algorithms
        return this.worker.postMessage({
          cmd: 'register',
          algorithms: this.algorithms
        })
        .then((r) => {
            self.initialized = true;
        }).then(postLayout.bind(this));
    } else {
	return postLayout();
    }
  }
  
  knownLayoutAlgorithms() {
    return this.worker.postMessage({ cmd: 'algorithms' })
  }
  
  knownLayoutOptions() {
    return this.worker.postMessage({ cmd: 'options' })
  }
  
  knownLayoutCategories() {
    return this.worker.postMessage({ cmd: 'categories' })
  }
  
  terminateWorker() {
    this.worker.terminate()
  }
  
}

class PromisedWorker {

  constructor(worker) {
    if (worker === undefined) {
      throw new Error("Missing mandatory parameter 'worker'.")
    }
    this.resolvers = {}
    this.worker = worker
    this.worker.onmessage = (answer) => {
      // why is this necessary?
      setTimeout(() => {
        this.receive(this, answer);
      }, 0)
    }
  }

  postMessage(msg) {
    let id = this.id || 0;
    this.id = id + 1
    msg.id = id
    let self = this
    return new Promise(function (resolve, reject) {
      // prepare the resolver
      self.resolvers[id] = function (err, res) {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      }
      // post the message
      self.worker.postMessage(msg);
    })
  }

  receive(self, answer) {
    let json = answer.data
    let resolver = self.resolvers[json.id]
    if (resolver) {
      delete self.resolvers[json.id]
      if (json.error) {
        resolver(json.error)
      } else {
        resolver(null, json.data)
      }
    }
  }

  terminate() {
    if (this.worker.terminate) {
      this.worker.terminate()
    }
  }

}
