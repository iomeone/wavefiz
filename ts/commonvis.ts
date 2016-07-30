/// <reference path="../typings/threejs/three.d.ts"/>
/// <reference path="./algorithms.ts"/>
/// <reference path="./potentials.ts"/>

module visualizing {

    export function assert(condition:boolean, message?:string) {
        if (!condition) throw message || "Assertion failed"
    }

    export function vector3(x:number, y:number, z:number): THREE.Vector3 {
        return new THREE.Vector3(x, y, z)
    }

    /* A class to help with animations. Adds callbacks (which trigger requestAnimationFrame) */
    export interface AnimatorClient {
        prepareForRender(time:number)
    }

    export class Redrawer {
        private clients_: AnimatorClient[] = []
        private rerender_: () => void
        private elapsed_: number
        private lastNow_: number
        private paused_ = true
        private rerenderScheduled_ = false

        constructor(public params: Parameters, rerender: () => void) {
            this.rerender_ = rerender
            this.elapsed_ = 0
            this.lastNow_ = Redrawer.now()
        }

        private static now(): number {
            return (performance || Date).now()
        }

        scheduleRerender() {
            if (! this.rerenderScheduled_) {
                this.rerenderScheduled_ = true
                window.requestAnimationFrame(() => this.fireClientsAndRerender())
            }
        }

        addClient(client: AnimatorClient) {
            this.clients_.push(client)
            this.scheduleRerender()
        }

        setPaused(flag: boolean) {
            if (this.paused_ && ! flag) {
                // We are unpausing
                this.lastNow_ = Redrawer.now()
                this.scheduleRerender()
            }
            this.paused_ = flag
        }

        reset() {
            this.elapsed_ = 0
        }

        paused(): boolean {
            return this.paused_
        }

        private fireClientsAndRerender() {
            this.rerenderScheduled_ = false
            let localClients = this.clients_.slice()
            if (! this.paused_) {
                const now = Redrawer.now()
                const dt = (now - this.lastNow_) / 1000.
                this.elapsed_ += dt * this.params.timescale
                this.lastNow_ = now
            }
            localClients.forEach((client: AnimatorClient) => client.prepareForRender(this.elapsed_))
            this.rerender_()
            if (! this.paused_) {
                this.scheduleRerender()
            }
        }
    }

    export class Parameters {
        public width: number = 800 // in "pixels"
        public height: number = 600 // in "pixels"
        public cameraDistance = 400 // how far back the camera is
        public maxX: number = 25 // maximum X value
        public timescale: number = 4.0 // multiplier for time
        public energyScale: number = 5 // coefficient for energy in the visualizer, only affects label
        public frequencyScale: number = .5 // coefficient for frequency when taking the fourier transform, relates to mass
        public meshDivision: number = 800 // how many points are in our mesh
        public psiScale: number = 250 // how much scale we visually apply to the wavefunction
        public psiAbsScale: number = this.psiScale * 1.75 // how much scale we visually apply to the psiAbs and phiAbs

        public centerForMeshIndex(idx: number): number {
            assert(idx >= 0 && idx < this.meshDivision, "idx out of range")
            let meshWidth = this.width / this.meshDivision
            return idx * meshWidth + meshWidth / 2.0
        }

        public convertYToVisualCoordinate(y: number) {
            // 0 is at top
            return this.height * (1.0 - y)
        }

        public convertYFromVisualCoordinate(y: number) {
            return 1.0 - y / this.height
        }

        public convertXToVisualCoordinate(x: number) {
            return (x / this.meshDivision) * this.width
        }        
    }
    
    // Builds a potential based on a function
    // let f be a function that accepts an x position, and optionally the x fraction (in the range [0, 1))
    // returns the new potential
    export function buildPotential(params:Parameters, potentialParam:number, f:algorithms.PotentialBuilderFunc): number[] {
        let potentialMesh: number[] = []
        for (let i = 0; i < params.meshDivision; i++) {
            const x = i / params.meshDivision
            potentialMesh.push(f(x, potentialParam))
        }
        return potentialMesh
    }

    export class State {

        constructor(private params_:Parameters) { }

        public static applyStateUpdate: (st:State) => void = () => {}

        public cameraRotationRadians: number = 0

        public potentialBuilder: algorithms.PotentialBuilderFunc = null
        public potential: number[] = []
        public potentialParameter: number = .15 // single draggable parameter in our potential, in the range [0, 1)

        public sketching: boolean = false
        public sketchLocations: THREE.Vector3[] = []

        public showPsi = true // show position psi(x)
        public showPsiAbs = false // show position probability |psi(x)|^2
        public showPhi = false; // show momentum phi(x)
        public showPhiAbs = false // show momentum probability |phi(x)|^2

        public paused = false

        // The energies array is sparse
        // Keys are energy bar identifiers, values are numbers
        public energies: { [key:string]:number; } = {}

        // Returns a dense array of the energy values, discarding the identifiers
        public energyValues(): number[] {
            return Object.keys(this.energies).map((k) => this.energies[k])
        }

        // Identifier support
        // TODO: describe this
        private static LastUsedIdentifier = 0
        public static newIdentifier() {
            return ++State.LastUsedIdentifier
        }


        public copy(): State {
            let clone = new State(this.params_)
            for (let key in this) {
                if (this.hasOwnProperty(key)) {
                    clone[key] = this[key]
                }
            }
            return clone
        }

        public modify(handler:(st:State) => void) {
            let cp = this.copy()
            handler(cp)
            cp.rebuildPotentialIfNeeded(this)
            State.applyStateUpdate(cp)
        }

        private rebuildPotentialIfNeeded(oldState:State) {
            if (! this.potentialBuilder) {
                this.potential = []
            } else if (this.potentialParameter !== oldState.potentialParameter || 
                    this.potentialBuilder !== oldState.potentialBuilder) {
                this.potential = buildPotential(this.params_, this.potentialParameter, this.potentialBuilder)
            }
        }
    }

    function timeThing(iters:number, funct: (() => void)) {
        const start = new Date().getTime()
        for (let iter=0; iter < iters; iter++) {
            funct()
        }
        const end = new Date().getTime()
        const duration = (end - start) / iters
        return duration
    }

    function arraysAreClose(arr1: algorithms.ComplexArray, arr2: algorithms.ComplexArray) {
        if (arr1.length != arr2.length) return false
        const eps = .0001
        for (let i=0; i < arr1.length; i++) {
            let val1 = arr1.at(i), val2 = arr2.at(i)
            if (Math.abs(val1.re - val2.re) > eps) {
                return false
            }
            if (Math.abs(val1.im - val2.im) > eps) {
                return false
            }
        }
        return true
    }
    
    function benchmarkImpl(forProfiling: boolean):string {
        const params = new Parameters()
        
        // SHO-type potential
        const baseEnergy = 0.25
        const xScaleFactor = 1.0 / 4.0
        const potential = buildPotential(params, .15, (x: number) => {
            // x is a value in [0, 1)
            // we have a value of 1 at x = 0.5
            const offsetX = 0.5
            const scaledX = (x - offsetX)
            return baseEnergy + xScaleFactor * (scaledX * scaledX / 2.0)
        })
        
        const center = algorithms.indexOfMinimum(potential)
        const energy = 2.5
        const input = {
            potentialMesh: potential,
            energy: energy,
            maxX:params.maxX
        }
        
        let psi = algorithms.classicallyResolvedAveragedNumerov(input)
        const maxIter = forProfiling ? 1024 : 32

        let text = ""

        const dx = .1, dfreq = .01

        // Verify correctness
        const values = psi.values
        let expected = algorithms.fourierTransformNaive(values.res, center, dx, dfreq)
        if (! arraysAreClose(expected, algorithms.fourierTransform(values.res, center,  dx, dfreq))) {
            text += "fourierTransform produces wrong result\n"
        }

        {
            let duration1 = timeThing(maxIter, () => {
                algorithms.fourierTransform(values.res, center,  dx, dfreq)
            })
            text += "fourierTransform: " + duration1.toFixed(2) + " ms     "
        }

        if (!forProfiling) {
            let duration2 = timeThing(maxIter, () => {
                algorithms.fourierTransformNaive(values.res, center, dx, dfreq)
            })
            text += "fourierTransformNaive: " + duration2.toFixed(2) + " ms"
        }

        return text 
    }
    
    export function benchmark(): string {
        return benchmarkImpl(false)
    }
    
    export function runForProfiling(): string {
        return benchmarkImpl(true)
    }
}
