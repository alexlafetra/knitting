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
*/

let mainCanvas;
let fabric;
let targetImage;
let extraForce;
let drawingCanvasCtx;


const scale = 20;
const seed = 1.7;
const growthScale = 10;
const dim = 30;
const noiseScale = 100.0/dim;
const iterations = 20;
let tempImage;
let imageHasUpdated = false;

function heightAt(u, v) {
    const radius = 1.0;
    // u, v in [0,1]; replace with image sampling for a real texture
    let n = noise(u * noiseScale + seed, v * noiseScale + seed);
    // return Math.pow(Math.max((1 - Math.sqrt(u*u + v*v))*radius,0),2);
    return n*n*2;
}

function preload(){
    tempImage = loadImage("test.png");
}
function loadCurvatureTexture(){
    targetImage = createGraphics(200,200);
    targetImage.image(tempImage,0,0,targetImage.width,targetImage.height);
    updateDrawingCanvas();
}
function setup(){
    mainCanvas = createCanvas(800,800,WEBGL);
    let seed = 100*Math.random();
    // let seed = 20;
    randomSeed(seed);
    noiseSeed(seed);
    // extraForce = createVector(0,0,0);
    extraForce = createVector(0.0,0.0,2.0);
    document.getElementById("random_seed_text").innerText = `seed: ${seed}`;
    drawingCanvasCtx = document.getElementById("target_image").getContext('2d');
    // fillNoiseTexture();
    loadCurvatureTexture();
    fabric = new Grid();
    ortho(-800,800,-800,800,0,10000);
}

function draw(){
    background(255);
    // orbitControl();
    fabric.update();
    fabric.render();
}

function updateDrawingCanvas(){
    drawingCanvasCtx.drawImage(targetImage.elt,0,0,targetImage.width,targetImage.height);
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
    targetImage.fill(e.shiftKey?[0,0,0]:[0,255,0]);
    targetImage.drawingContext.filter = 'blur(30px)'; // Set blur strength in pixels
    targetImage.noStroke();
    targetImage.ellipse(coords.x,coords.y,15,15);
    targetImage.pop();
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
        const damping = 1;
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
        if(!(currentLength > 1e-6) || !isFinite(currentLength)) return;
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