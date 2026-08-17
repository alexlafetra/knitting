/*

okay so, some steps that i'm thinking of:

1. load model, compute angle between each triangle
2. UV unwrap the angle texture, lay it over a higher-res grid (which is the yarn)
3. Compute the force needed (ie, how much of a spring) each grid segment will need to deform into the angles from the UV unwrap texture

okay i think first step should be going from test heightmap --> scrunch grid

ok some more thoughts:

one approach to modeling the final output surface would be creating a 3d model, UV unwrapping it while storing curvature or height data on the UV map,
then using that to compute the fabric tension

pros: you can model things using traditional 3d modeling software, this whole process could become a blender plugin,
    UV math already done
cons: difficult for ppl unfamiliar with blender, no cool visualization, relies on other software

another approach is to have the user draw the heightmap in-browser, or load in a heightmap. This skips the 3D modelling side, and instead is kind of a drawing-first approach.
I think this could still produce good results

ok one fundamental flaw, heightmap can't do overhangs which would otherwise be totally doable using knit materials. 
A curvature map would be better for this, let me try prototyping a heightmap --> curvature map

negative curvature (concave) means shorter/fewer springs/stitches, positive means larger/more
this would be a switch from point-displacing (where there's a known target point position) to more force-driving where
there's a known spring length? or wait, maybe you could 

7.24.26
okay, webGL is working and working really well! which is awesome. The drawing is fun and intuitive, but the cloth doesn't feel stiff/constrained
enough to behave like yarn. Next up i think we need an angular constraint to control how sharp a vertice can be
also, a way to generate meshes in patches (instead of just in a square) is key. I'm imagining this could let me
start with UV unwrapped patches (or make a little UV unwrapper) which can then use those as the base patches.

Maybe the other yarn literature has an approach to this! like a good way of splitting a model into knittable patches.

*/

let mainCanvas;
let fabric;
let targetImage;
let curvatureTexture_webgl;
let drawingCanvasCtx;
let sketchpadShader;
let sketchpadVAO;

let curvatureScaleFactor = 1.0;
let expansionScaleFactor = 2.0;
let contractionScaleFactor = 1.0;

let wind = {
    x : 0,
    y : 0,
    z : 0.0
};
let bendStiffness = {
    x : 0.01,
    y : 0.01,
    diagonal : 0.01,
    locked : true
};
let springStiffness = 0.85;
let sketchpadDim = 100;
let damping = 0.2;
let brushSize = 10;
let blurSize = 10;
let brushColor = 255;
const scale = 10;
const seed = 1.7;
const growthScale = 10;
const dim = 100;
const noiseScale = 100.0/dim;
const iterations = 50;
let tempImage;
let imageHasUpdated = false;
let brush = "draw";//draw or erase

function heightAt(u, v) {
    const radius = 1.0;
    // u, v in [0,1]; replace with image sampling for a real texture
    let n = noise(u * noiseScale + seed, v * noiseScale + seed);
    // return Math.pow(Math.max((1 - Math.sqrt(u*u + v*v))*radius,0),2);
    return n*n*2;
}

function fullReset(){

}

function clearSketchpad(){
    fillSketchpad([0,0,0]);
}

function fillSketchpad(c){
    targetImage.background(c);
    updateDrawingCanvas();
}

function preload(){
    tempImage = loadImage("images/test.png");
}
function loadCurvatureTexture(){
    targetImage = createGraphics(200,200);
    targetImage.background(0,0,0);
    // targetImage.fill(0,0,0);
    // targetImage.ellipse(50,100,50,50);
    // targetImage.ellipse(150,100,100,100);

    // targetImage.image(tempImage,0,0,targetImage.width,targetImage.height);
}
function initSketchpad(){
    drawingCanvasCtx = document.getElementById("target_image").getContext('webgl2');
    sketchpadShader = createRawWebGLProgram(drawingCanvasCtx,sketchpadShaderSrc.vert,sketchpadShaderSrc.frag);
    loadCurvatureTexture();

    // full-screen triangle (covers clip space, no need for a quad)
    const verts = new Float32Array([
        -1, -1,
         3, -1,
        -1,  3
    ]);

    const vao = drawingCanvasCtx.createVertexArray();
    drawingCanvasCtx.bindVertexArray(vao);

    const buf = drawingCanvasCtx.createBuffer();
    drawingCanvasCtx.bindBuffer(drawingCanvasCtx.ARRAY_BUFFER, buf);
    drawingCanvasCtx.bufferData(drawingCanvasCtx.ARRAY_BUFFER, verts, drawingCanvasCtx.STATIC_DRAW);

    drawingCanvasCtx.enableVertexAttribArray(0); // aCoord
    drawingCanvasCtx.vertexAttribPointer(0, 2, drawingCanvasCtx.FLOAT, false, 0, 0);

    sketchpadVAO = vao; // store for render loop

    curvatureTexture_webgl = drawingCanvasCtx.createTexture();
    drawingCanvasCtx.bindTexture(drawingCanvasCtx.TEXTURE_2D, curvatureTexture_webgl);
    // set params once — they don't need to be redeclared every frame
    drawingCanvasCtx.texParameteri(drawingCanvasCtx.TEXTURE_2D, drawingCanvasCtx.TEXTURE_WRAP_S, drawingCanvasCtx.CLAMP_TO_EDGE);
    drawingCanvasCtx.texParameteri(drawingCanvasCtx.TEXTURE_2D, drawingCanvasCtx.TEXTURE_WRAP_T, drawingCanvasCtx.CLAMP_TO_EDGE);
    drawingCanvasCtx.texParameteri(drawingCanvasCtx.TEXTURE_2D, drawingCanvasCtx.TEXTURE_MIN_FILTER, drawingCanvasCtx.LINEAR);
    drawingCanvasCtx.texParameteri(drawingCanvasCtx.TEXTURE_2D, drawingCanvasCtx.TEXTURE_MAG_FILTER, drawingCanvasCtx.LINEAR);

    updateDrawingCanvas();
}

function updateDrawingCanvas(){
    drawingCanvasCtx.viewport(0, 0, mainCanvas.width*2, mainCanvas.height*2);
    drawingCanvasCtx.clearColor(0.5,0.5,0.5,1.0);
    drawingCanvasCtx.clear(drawingCanvasCtx.COLOR_BUFFER_BIT);

    drawingCanvasCtx.useProgram(sketchpadShader);

    drawingCanvasCtx.activeTexture(drawingCanvasCtx.TEXTURE0);
    drawingCanvasCtx.bindTexture(drawingCanvasCtx.TEXTURE_2D, curvatureTexture_webgl);
    // pull the latest pixels from targetImage's canvas into the GPU texture
    drawingCanvasCtx.texImage2D(
        drawingCanvasCtx.TEXTURE_2D, 0, drawingCanvasCtx.RGBA,
        drawingCanvasCtx.RGBA, drawingCanvasCtx.UNSIGNED_BYTE,
        targetImage.canvas // the DOM canvas element p5 is drawing into
    );
    
    drawingCanvasCtx.uniform1i(drawingCanvasCtx.getUniformLocation(sketchpadShader, "inputData"), 0);

    drawingCanvasCtx.bindVertexArray(sketchpadVAO);
    drawingCanvasCtx.drawArrays(drawingCanvasCtx.TRIANGLES, 0, 3);
}

function setup(){
    mainCanvas = createCanvas(800,800,WEBGL);
    initCameraControls(mainCanvas.canvas);
    let seed = 100*Math.random();
    // let seed = 20;
    randomSeed(seed);
    noiseSeed(seed);
    initSketchpad();
    initGL();
    // fabric = new Grid();
    // ortho(-800,800,-800,800,0,10000);
}

function draw(){
    background(0);
    // orbitControl();
    // fabric.update();
    // fabric.render();
    updateGL();
    renderGL();
}

function fillNoiseTexture(){
    const w = 200;
    const h = 200;
    // targetImage = createImage(w,h);
    targetImage = createGraphics(w,h);
    targetImage.loadPixels();
    for(let i = 0; i<targetImage.pixels.length; i+=4){
        const x = Math.trunc(i/4)%w;
        const y = Math.trunc(i/(4*w)); 
        const val = 255*Math.max(heightAt(x/w - 0.5,y/h - 0.5),0);
        targetImage.pixels[i] = val>122.5?map(val,122.5,255,0,255):0;
        targetImage.pixels[i+1] = val;
        targetImage.pixels[i+2] = val<122.5?map(val,0,122.5,255,0):0;
        targetImage.pixels[i+3] = 255;

    }
    targetImage.updatePixels();
    updateDrawingCanvas();
}

function heightFromImage(u,v){
    //stored in the green channel, since R and B are used for visualizing the curvature
    return (targetImage.get(u*targetImage.width,v*targetImage.height)[1])/255;
}

function drawOnImage(e){
    if(!e.buttons && e.type != "click")
        return;

    const coords = {
        x : e.offsetX,
        y : e.offsetY
    };
    targetImage.push();
    if(brush == 'erase')
        targetImage.erase(255,255);
    targetImage.fill(e.shiftKey?[255- brushColor]:[brushColor]);
    if(brush != 'erase')
        targetImage.drawingContext.filter = `blur(${blurSize}px)`; // Set blur strength in pixels
    targetImage.noStroke();
    targetImage.ellipse(coords.x,coords.y,brushSize,brushSize);
    targetImage.pop();
    targetImage.noErase();
    updateDrawingCanvas();
    imageHasUpdated = true;
}


class Grid{
    constructor(){
        this.vertices = [];
        this.springSegments = [];
        for(let i = 0; i<dim; i++){
            for(let j = 0; j<dim; j++){
                let newV = new GridVertex(i,j,scale);
                //all edges
                newV.pinned = ((!i) || (!j) || (i == (dim-1)) || (j == (dim-1)));
                //corners + midpoints
                // newV.pinned = ((!i && !j) || (i == dim/2 && !j) || (j == dim/2 && !i) || (i == dim/2 && (j==dim-1)) || (j == dim/2 && i == (dim-1)) || (!i && j == (dim-1)) || (!j && i == (dim-1)) || ((i == (dim-1))&& (j == (dim-1))));
                //just corners
                // newV.pinned = ((!i && !j) || (!i && j == (dim-1)) || (!j && i == (dim-1)) || ((i == (dim-1))&& (j == (dim-1))));
                //two points
                // newV.pinned = (i === Math.floor(dim / 2) && j === Math.floor(dim / 2)) || (i === Math.floor(dim / 2) + 1 && j === Math.floor(dim / 2));
                if(newV.pinned){
                    newV.currentPosition = createVector(i*scale, j*scale, 0);
                }
                else{
                    //add random z to loosen up the sim/get it to 3D fold
                    newV.currentPosition = createVector(i*scale, j*scale, random(0,1));
                    newV.lastPosition = newV.currentPosition.copy();
                }
                newV.coords = {u:i/dim,v:j/dim};
                this.vertices.push(newV);
            }
        }
        const normalStiffness = 0.5;
        const neighborStiffness = 0.8;
        //create all the springs
        for(let x = 0; x<dim; x++){
            for(let y = 0; y<dim; y++){
                const index = x + y * dim;
                //right
                if(x < dim-1)
                    this.springSegments.push(new SpringSegment(this.vertices[index],this.vertices[index+1],normalStiffness));
                //bottom
                if(y < dim-1)
                    this.springSegments.push(new SpringSegment(this.vertices[index],this.vertices[index + dim],normalStiffness));
                if(x < dim - 1 && y < dim - 1){
                    this.springSegments.push(new SpringSegment(this.vertices[index],this.vertices[index + dim + 1],normalStiffness));
                    this.springSegments.push(new SpringSegment(this.vertices[index+1],this.vertices[index + dim],normalStiffness));
                }
                // neighbor springs, to prevent sharp folds
                if (x < dim - 2)
                    this.springSegments.push(new SpringSegment(this.vertices[index], this.vertices[index + 2],neighborStiffness,false));
                if (y < dim - 2)
                    this.springSegments.push(new SpringSegment(this.vertices[index], this.vertices[index + 2 * dim],neighborStiffness,false));
            }
        }
    }
    verletUpdate(){
        // const damping = 0.985;
        // const damping = 1;
        for(let v of this.vertices){
            //if pinned, skeeeiiip
            if(v.pinned){
                // v.currentPosition = v.targetPosition.copy();
                continue;
            }
            const vel = p5.Vector.sub(v.currentPosition,v.lastPosition).add(extraForce).mult(damping);
            const newPosition = p5.Vector.add(v.currentPosition,vel);
            v.lastPosition = v.currentPosition.copy();
            v.currentPosition = newPosition;
        }
    }
    update(){
        this.verletUpdate();
        //doing an accumulation process so that all the springs update from the previous data simultaneously
        for (let k = 0; k < iterations; k++){
            for (let v of this.vertices){ 
                v.correctionSum = createVector(0,0,0);
                v.correctionCount = 0;
            }
            for (let spring of this.springSegments){
                spring.accumulate();
            }
            imageHasUpdated = false;
            for (let v of this.vertices){
                if (v.pinned || v.correctionCount === 0)
                    continue;
                v.currentPosition.add(p5.Vector.div(v.correctionSum, v.correctionCount));
            }
        }
    }
    //not implemented yet
    restrictCurvature(){
        for(let p of this.vertices){
            //always at least 3 connected springs
            for(let connectedSpringA of p.connectedSprings){
                for(let connectedSpringB of p.connectedSprings){
                    //if they're different springs
                    if(connectedSpringA != connectedSpringB){
                        let A = (connectedSpringA.v1 != connectedSpringB.v1) ? connectedSpringA.v1:connectedSpringA.v2;
                        let C = (connectedSpringA.v1 != connectedSpringB.v1) ? connectedSpringB.v1:connectedSpringB.v2;
                        const BA = p5.Vector.sub(p.currentPosition,A.currentPosition);
                        const BC = p5.Vector.sub(p.currentPosition,C.currentPosition);
                        const cosine = BA.dot(BC)/(BA.mag()*BC.mag());
                        const angle = Math.acos(cosine);
                        // console.log(angle);

                    }
                }
            }
        }
    }
    render(){
        colorMode(RGB,255);
        push();
        // rotateY(PI/2);
        rotateX(PI/3);
        rotateZ(PI/4);
        translate(-dim*scale/2,-dim*scale/2);
        strokeWeight(1);
        stroke(255,0,0);
        // for(let v of this.vertices){
        //     point(v.currentPosition.x,v.currentPosition.y,v.currentPosition.z);
        // }
        strokeWeight(1);
        colorMode(HSB,100);
        for(let e of this.springSegments){
            if(!e.rendered)
                continue;
            let c = map(e.stress,0,100,100,0)
            // let c = map(e.stress,0,2,100,0);
            stroke(c,100,100);
            // stroke(e.color/500);
            line(e.v1.currentPosition.x,e.v1.currentPosition.y,e.v1.currentPosition.z,e.v2.currentPosition.x,e.v2.currentPosition.y,e.v2.currentPosition.z);
        }
        pop();
    }
}

function mousePressed(){
    // extraForce = createVector(0.0,0.0,2.0);
}
function mouseReleased(){
    // extraForce = createVector(0.0,0.0,0.0);
}

class GridVertex{
    constructor(i,j,gap){
        this.currentPosition = createVector(0,0,0);
        this.targetPosition = createVector(i*gap,j*gap,heightAt(i,j));
        this.pinned = false;
        this.connectedSprings = [];
    }
}

class SpringSegment{
    constructor(v1,v2,stiffness,rendered = true){
        this.stiffness = stiffness;
        this.stress = 0;
        this.rendered = rendered;
        this.v1 = v1;
        this.v2 = v2;
        this.v1.connectedSprings.push(this);
        this.v2.connectedSprings.push(this);
        this.startLength = p5.Vector.dist(this.v1.currentPosition,this.v2.currentPosition);
        this.clothCoord = {u:(this.v1.coords.u + this.v2.coords.u)/2,v:(this.v1.coords.v + this.v2.coords.v)/2};
        let h = heightFromImage(this.clothCoord.u,this.clothCoord.v);
        this.restLength =  this.startLength*(1.0+h*1.0);
        this.color = 255*h*10;
    }
    //calc all this before constrain(), so springs are updated simultaneously
    accumulate(){
        //update target rest length length
        if(imageHasUpdated){
            let h = heightFromImage(this.clothCoord.u,this.clothCoord.v);
            this.restLength =  this.startLength*(1.0+h*1.0);
        }

        let a = this.v1, b = this.v2;
        let delta = p5.Vector.sub(a.currentPosition, b.currentPosition);
        let currentLength = delta.mag();
        if(!(currentLength > 1e-6) || !isFinite(currentLength))
            return;
        let diff = currentLength - this.restLength;
        this.stress = currentLength*1.5;
        let correction = delta.mult(this.stiffness * diff / currentLength);
        if(!a.pinned){
            a.correctionSum.sub(correction);
            a.correctionCount++;
        }
        if(!b.pinned){
            b.correctionSum.add(correction);
            b.correctionCount++;
        }
    }
    constrain(){
        // //constrain via hooks law
        // let a = this.v1;
        // let b = this.v2;
        // //vector between vertex points
        // let delta = p5.Vector.sub(a.currentPosition,b.currentPosition);
        // let currentLength = delta.mag();

        // if(!(currentLength > 1e-6) || !isFinite(currentLength))
        //     return;

        // let diff = (currentLength - this.restLength);

        // //stress used to color the threads
        // // this.stress = this.restLength/currentLength;
        // this.stress = currentLength;
        // let correction = delta.mult(this.stiffness * diff/currentLength);
        // if(correction.mag()>0.1)
        //     this.pinned = false;
        // if(!a.pinned)
        //     a.currentPosition.sub(correction);
        // if(!b.pinned)
        //     b.currentPosition.add(correction);
    }
}

const glsl = x => x;

//gray is neutral, black is negative curvature, white is positive
const sketchpadShaderSrc = {
    vert: ``+glsl`#version 300 es

        precision highp float;

        layout(location=0) in vec2 aCoord;
        out vec2 vTexCoord;

        void main() {
            vTexCoord = aCoord * 0.5 + 0.5;
            vTexCoord.y = 1.0 - vTexCoord.y; // correct for canvas → GL texture orientation
            gl_Position = vec4(aCoord,1.0,1.0);
        }
        `,
    frag: ``+glsl`#version 300 es
            precision highp float;

            uniform sampler2D inputData;

            in vec2 vTexCoord;
            out vec4 outColor;

            // Converts HSL to RGB
            vec3 hsl2rgb(vec3 c) {
                vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
                return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
            }

            void main(){
                //this is a REALLY fragile way to do this, but I'm not fixing it rn
                float dim = float(textureSize(inputData,0)) * 0.5;
                vec2 coord = vec2(gl_FragCoord.x/dim,1.0 - gl_FragCoord.y/dim);
                vec4 color = texture(inputData,coord);
                //detecting mask edges
                if(color.a <= 0.01){
                    outColor = vec4(0.0);
                    return;
                }
                outColor = vec4(hsl2rgb(vec3(1.7 - color.g/1.5,1.0,0.5)),1.0);
            }
            `
}