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

function preload(){
    // cleanImage = loadImage("temp.jpg");

}
function setup(){
    mainCanvas = createCanvas(800,800,WEBGL);
    fabric = new Grid();
    ortho(-800,800,-800,800,0,2000);
    let seed = random(0,1);
    seed = 0.5;
    randomSeed(seed);
    noiseSeed(seed);
    console.log(seed);
}

function draw(){
    orbitControl();
    background(255);
    fabric.update();
    fabric.render();
}

const scale = 20;
const seed = 1.7;
const heightScale = 200;
const dim = 30;
const noiseScale = 10/dim;

function heightAt(u, v) {
  // u, v in [0,1]; replace with image sampling for a real texture
  let n = noise(u * noiseScale + seed, v * noiseScale + seed * 1.7);
  return (n - 0.5) * 2 * heightScale;
}

class Grid{
    constructor(){
        this.vertices = [];
        this.springSegments = [];
        for(let i = 0; i<dim; i++){
            for(let j = 0; j<dim; j++){
                let newV = new GridVertex(i,j,scale);
                newV.pinned = ((!i) || (!j) || (i == (dim-1)) || (j == (dim-1)));
                if(newV.pinned){
                    // newV.currentPosition = newV.targetPosition.copy();
                    newV.currentPosition = createVector(i*scale, j*scale, 0);
                    // newV.targetPosition = newV.currentPosition.copy();
                }
                else{
                    newV.currentPosition = createVector(i*scale, j*scale, random(-1,1));
                    newV.lastPosition = newV.currentPosition.copy();
                }
                this.vertices.push(newV);
            }
        }
        //create all the springs
        for(let x = 0; x<dim; x++){
            for(let y = 0; y<dim; y++){
                const index = x + y * dim;
                //right
                if(x < dim-1)
                    this.springSegments.push(new SpringSegment(scale,this.vertices[index],this.vertices[index+1]));
                //bottom
                if(y < dim-1)
                    this.springSegments.push(new SpringSegment(scale,this.vertices[index],this.vertices[index + dim]));
                if(x < dim - 1 && y < dim - 1){
                    this.springSegments.push(new SpringSegment(scale,this.vertices[index],this.vertices[index + dim + 1]));
                    this.springSegments.push(new SpringSegment(scale,this.vertices[index+1],this.vertices[index + dim]));
                }
            }
        }
    }
    verletUpdate(){
        const damping = 0.985;
        for(let v of this.vertices){
            //if pinned, skeeeiiip
            if(v.pinned){
                // v.currentPosition = v.targetPosition.copy();
                continue;
            }
            const vel = p5.Vector.sub(v.currentPosition,v.lastPosition).mult(damping);
            const newPosition = p5.Vector.add(v.currentPosition,vel);
            v.lastPosition = v.currentPosition.copy();
            v.currentPosition = newPosition;
        }
    }
    update(){
        const iterations = 20;
        this.verletUpdate();
        for (let k = 0; k < iterations; k++){
            for(let spring of this.springSegments){
                spring.constrain();
            }
        }
    }
    render(){
        colorMode(RGB,255);
        push();
        rotateX(PI/3);
        rotateZ(PI/4);
        translate(-dim*scale/2,-dim*scale/2);
        strokeWeight(1);
        stroke(255,0,0);
        for(let v of this.vertices){
            point(v.currentPosition.x,v.currentPosition.y,v.currentPosition.z);
        }
        strokeWeight(1);
        // stroke(0,0,0);
        colorMode(HSB,100);
        for(let e of this.springSegments){
            let c = map(e.stress,0,100,100,0)
            stroke(c,100,100);
            line(e.v1.currentPosition.x,e.v1.currentPosition.y,e.v1.currentPosition.z,e.v2.currentPosition.x,e.v2.currentPosition.y,e.v2.currentPosition.z);
        }
        pop();
    }
}

class GridVertex{
    constructor(i,j,gap){
        this.targetPosition = createVector(i*gap,j*gap,heightAt(i,j));
        this.pinned = false;
    }
}

class SpringSegment{
    constructor(currentLength,v1,v2){
        this.currentLength = currentLength;
        this.stress = 0;
        this.v1 = v1;
        this.v2 = v2;
        const midPoint = p5.Vector.sub(this.v1.currentPosition,this.v2.currentPosition).div(2);
        this.restLength = scale + heightAt(midPoint.x,midPoint.y)/2;
        // this.restLength = p5.Vector.dist(this.v1.targetPosition,this.v2.targetPosition);
    }
    constrain(){
        let a = this.v1;
        let b = this.v2;
        //vector between vertex points
        let delta = p5.Vector.sub(a.currentPosition,b.currentPosition);
        let dist = delta.mag();

        if(!(dist > 1e-6) || !isFinite(dist))
            return;

        let diff = (dist - this.restLength) / dist;
        this.stress = dist;
        let correction = delta.mult(0.5 * diff);
        // if(!a.pinned)
            a.currentPosition.sub(correction);
        // if(!b.pinned)
            b.currentPosition.add(correction);

    }
}

const glsl = x => x;