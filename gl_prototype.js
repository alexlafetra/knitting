let gl;
let renderShader;
let copyShader;
let verletShader;
let constraintShader;

//A is current state, B is the previous frame, and C is where you write to
let posTexA;
let posTexB;
let posTexC;

let posFboA;
let posFboB;
let posFboC;
let posTexD, posFboD;
let posBuffers; // [{tex,fbo}, ...] — index 0 = current, 1 = previous, 2/3 = scratch

let lineData;
let vao;
let fullScreenVao;
let lineCount;

let curvatureTex;
let originalPositionTex;

const camera = {
    theta: Math.PI / 2,   // horizontal angle around center
    phi: Math.PI / 2,     // vertical angle from +Y axis
    zoom: 1.2,
    minZoom: 0.15,
    maxZoom: 5,
    minPhi: 0.05,
    maxPhi: Math.PI - 0.05
};

function initCameraControls(canvasEl){
    let dragging = false;
    let lastX = 0, lastY = 0;
    let pinchStartDist = null;
    let pinchStartZoom = 1;

    const rotateSpeed = 0.006;
    const zoomSpeed = 0.0025;

    function clampPhi(){
        camera.phi = Math.min(camera.maxPhi, Math.max(camera.minPhi, camera.phi));
    }
    function clampZoom(){
        camera.zoom = Math.min(camera.maxZoom, Math.max(camera.minZoom, camera.zoom));
    }
    function touchDist(touches){
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // --- mouse ---
    canvasEl.addEventListener('mousedown', e => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
    });
        // add to camera state
    camera.panX = 0;
    camera.panY = 0;
    const panSpeedBase = 1.0; // tune

    window.addEventListener('mousemove', e => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = -(e.clientY - lastY);
        lastX = e.clientX;
        lastY = e.clientY;

        if (e.shiftKey) {
            camera.panX -= dx * camera.zoom * panSpeedBase;
            camera.panY += dy * camera.zoom * panSpeedBase; // screen-down = world-up, so flip
        } else {
            camera.theta -= dx * rotateSpeed;
            camera.phi   -= dy * rotateSpeed;
            clampPhi();
        }
    });
    window.addEventListener('mouseup', () => dragging = false);
    canvasEl.addEventListener('wheel', e => {
        e.preventDefault();
        camera.zoom *= 1 + e.deltaY * zoomSpeed;
        clampZoom();
    }, { passive: false });

    // --- touch ---
    canvasEl.addEventListener('touchstart', e => {
        if (e.touches.length === 1){
            dragging = true;
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2){
            dragging = false;
            pinchStartDist = touchDist(e.touches);
            pinchStartZoom = camera.zoom;
        }
    }, { passive: true });

    canvasEl.addEventListener('touchmove', e => {
        if (e.touches.length === 1 && dragging){
            const dx = e.touches[0].clientX - lastX;
            const dy = e.touches[0].clientY - lastY;
            lastX = e.touches[0].clientX;
            lastY = e.touches[0].clientY;
            camera.theta -= dx * rotateSpeed;
            camera.phi   -= dy * rotateSpeed;
            clampPhi();
        } else if (e.touches.length === 2 && pinchStartDist !== null){
            e.preventDefault(); // stop page-level pinch-zoom/scroll
            const dist = touchDist(e.touches);
            camera.zoom = pinchStartZoom * (pinchStartDist / dist);
            clampZoom();
        }
    }, { passive: false });

    canvasEl.addEventListener('touchend', e => {
        if (e.touches.length < 2) pinchStartDist = null;
        if (e.touches.length === 0) dragging = false;
    });
}

function createImageTexture(canvasEl){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        canvasEl // any TexImageSource: <canvas>, <img>, <video>, ImageBitmap...
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return tex;
}

function createRawWebGLProgram(gl, vsSource, fsSource) {
    const vertShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertShader, vsSource);
    gl.compileShader(vertShader);
    if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
        console.error('Vertex shader error:', gl.getShaderInfoLog(vertShader));
        return null;
    }

    const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragShader, fsSource);
    gl.compileShader(fragShader);
    if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
        console.error('Fragment shader error:', gl.getShaderInfoLog(fragShader));
        return null;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        return null;
    }

    return program;
}

function makeFramebuffer(texture){

    const fb = gl.createFramebuffer();

    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);

    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
    );

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer incomplete:', status.toString(16));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // unbind

    return fb;
}

function initGL(){
    gl = mainCanvas.drawingContext;

        // Required for RGBA32F (and other float formats) to be render-target-capable
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) {
        console.error('EXT_color_buffer_float not supported on this device/browser');
    }

    renderShader = createRawWebGLProgram(gl,vertShader,renderFragShader);
    verletShader = createRawWebGLProgram(gl, quadVertShader, verletFragShader);
    constraintShader = createRawWebGLProgram(gl, quadVertShader, constraintFragShader);

    lineData = createSpringMesh();
    posTexA = createPositionTexture();
    posTexB = createPositionTexture();
    posTexC = createPositionTexture();
    posTexD = createPositionTexture();
    originalPositionTex = createPositionTexture();

    posFboA = makeFramebuffer(posTexA);
    posFboB = makeFramebuffer(posTexB);
    posFboC = makeFramebuffer(posTexC);
    posFboD = makeFramebuffer(posTexD);

    posBuffers = [
        { tex: posTexA, fbo: posFboA },
        { tex: posTexB, fbo: posFboB },
        { tex: posTexC, fbo: posFboC },
        { tex: posTexD, fbo: posFboD },
    ];

    curvatureTex = createImageTexture(targetImage.canvas);

    gl.enable(gl.DEPTH_TEST);
    gl.clearDepth(1.0);

    //binding the line buffer for drawing the threads
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);

    gl.bufferData(
        gl.ARRAY_BUFFER,
        lineData,
        gl.STATIC_DRAW
    );

    const vertexByteSize = 4*4; //4 numbers per vertex, each 4 bytes, so each vert is 16b long

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(
        0,
        2,
        gl.FLOAT,
        false,
        vertexByteSize,
        0
    );
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(
        1,
        2,
        gl.FLOAT,
        false,
        vertexByteSize,
        2 * 4);

    lineCount = lineData.length/4;

    const quad = new Float32Array([
        -1,-1,
        3,-1,
        -1, 3
    ]);

    fullScreenVao = gl.createVertexArray();
    gl.bindVertexArray(fullScreenVao);

    const buffer2 = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER,buffer2);

    gl.bufferData(
        gl.ARRAY_BUFFER,
        quad,
        gl.STATIC_DRAW
    );

    gl.enableVertexAttribArray(0);

    gl.vertexAttribPointer(
        0,
        2,
        gl.FLOAT,
        false,
        0,
        0
    );
}

//initializes a big array with position data
function createPositionTexture(){
    randomSeed(seed);
    //buffer to hold position data
    const positions = new Float32Array(dim*dim*4);

    for(let y=0;y<dim;y++){
        for(let x=0;x<dim;x++){

            const i=(y*dim+x)*4;

            positions[i+0]=x*scale;
            positions[i+1]=y*scale;
            positions[i+2]=random()*2;
            positions[i+3]=1;
        }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);

    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        dim,
        dim,
        0,
        gl.RGBA,
        gl.FLOAT,
        positions
    );

    console.log(gl.getError());

    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);

    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return tex;
}

function createSpringMesh(){

    const verts = [];

    function addLine(ax,ay,bx,by){
        //push a whole line (A,B)
        verts.push(ax,ay,bx,by);
        verts.push(bx,by,ax,ay);
    }

    for(let y=0;y<dim;y++){

        for(let x=0;x<dim;x++){
            //right
            if(x<dim-1)
                addLine(x,y,x+1,y);
            //bottom
            if(y<dim-1)
                addLine(x,y,x,y+1);

            //top and left
            if(x<dim-1 && y<dim-1){
                addLine(x,y,x+1,y+1);
                addLine(x+1,y,x,y+1);
            }
            // neighbor springs, to prevent sharp folds
            // if (x < dim - 2)
            //     addLine(x,y,x+2,y);
            // if (y < dim - 2)
            //     addLine(x,y,x,y+2);
        }

    }
    return new Float32Array(verts);
}

function updateGL(){
    gl.viewport(0, 0, dim, dim);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(fullScreenVao);

    //update curvature texture
    gl.bindTexture(gl.TEXTURE_2D, curvatureTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, targetImage.canvas);

    const current  = posBuffers[0];
    const previous = posBuffers[1];
    let readBuf  = posBuffers[2]; // verlet writes here first
    let writeBuf = posBuffers[3];

    // --- verlet integration: current + previous -> readBuf ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, readBuf.fbo);
    gl.useProgram(verletShader);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, current.tex);
    gl.uniform1i(gl.getUniformLocation(verletShader, "positionTex"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, previous.tex);
    gl.uniform1i(gl.getUniformLocation(verletShader, "previousTex"), 1);
    gl.uniform1f(gl.getUniformLocation(verletShader, "damping"), damping);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- constraint relaxation: ping-pong readBuf/writeBuf ---
    gl.useProgram(constraintShader);
    for (let i = 0; i < iterations; i++){
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeBuf.fbo);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, readBuf.tex);
        gl.uniform1i(gl.getUniformLocation(constraintShader, "positionTex"), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, curvatureTex);
        gl.uniform1i(gl.getUniformLocation(constraintShader, "curvatureTexture"), 1);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, originalPositionTex);
        gl.uniform1i(gl.getUniformLocation(constraintShader, "initialPositionTexture"), 2);
        gl.uniform3f(gl.getUniformLocation(constraintShader, "uWind"), wind.x,wind.y,wind.z);
        gl.uniform3f(gl.getUniformLocation(constraintShader, "uBendStiffness"), bendStiffness.x,bendStiffness.y,bendStiffness.diagonal);
        gl.uniform1f(gl.getUniformLocation(constraintShader, "initialLength"), scale);
        gl.uniform1f(gl.getUniformLocation(constraintShader, "scale"), scale);
        gl.uniform1f(gl.getUniformLocation(constraintShader, "uExpansionScale"), expansionScaleFactor);
        gl.uniform1f(gl.getUniformLocation(constraintShader, "uContractionScale"), contractionScaleFactor);
        gl.uniform1f(gl.getUniformLocation(constraintShader, "initialLengthDiagonal"), scale * Math.SQRT2);
        gl.uniform1f(gl.getUniformLocation(constraintShader, "uStiffness"), springStiffness);

        gl.drawArrays(gl.TRIANGLES, 0, 3);

        [readBuf, writeBuf] = [writeBuf, readBuf]; // swap for next iteration
    }
    // after swapping, the latest result is in `readBuf`

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    // gl.viewport(0, 0, mainCanvas.width, mainCanvas.height);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    // rotate roles for next frame
    posBuffers[0] = readBuf;   // new current  = final constrained result
    posBuffers[1] = current;   // new previous = old current
    posBuffers[2] = previous;  // free scratch
    posBuffers[3] = writeBuf;  // free scratch
}

function renderGL(){

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // draw to canvas, not whatever FBO was last bound
    gl.viewport(0,0,mainCanvas.width*2,mainCanvas.height*2);

    gl.clearColor(1,1,1,1);

    gl.clear(
        gl.COLOR_BUFFER_BIT |
        gl.DEPTH_BUFFER_BIT
    );

    gl.useProgram(renderShader);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, posBuffers[0].tex);
    const positionLocation = gl.getUniformLocation(renderShader, "positionTex");
    const projectionLoc = gl.getUniformLocation(renderShader, "projection");
    const viewLoc       = gl.getUniformLocation(renderShader, "view");
    gl.uniform1i(positionLocation,0);
    gl.uniform1f(gl.getUniformLocation(renderShader, "scale"), scale);//pass in scale

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, originalPositionTex);
    gl.uniform1i(gl.getUniformLocation(renderShader, "initialPositionTexture"), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, curvatureTex);
    gl.uniform1i(gl.getUniformLocation(renderShader, "curvatureTexture"), 2);

    const margin = 50;
    const clothWidth = (dim - 1) * scale;
    const clothHeight = (dim - 1) * scale;
    const centerX = clothWidth * 0.5;
    const centerY = clothHeight * 0.5;

    const baseHalfW = clothWidth * 0.5 + margin;
    const baseHalfH = clothHeight * 0.5 + margin;
    let halfW = baseHalfW * camera.zoom;
    let halfH = baseHalfH * camera.zoom;

    const projection = Mat4.ortho(
        centerX - halfW,
        centerX + halfW,
        centerY + halfH,
        centerY - halfH,
        -20000,
        20000
    );

    const canvasAspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    const boxAspect = halfW / halfH;

    if (canvasAspect > boxAspect) {
        halfW = halfH * canvasAspect; // widen box to fill canvas width
    } else {
        halfH = halfW / canvasAspect; // grow box to fill canvas height
    }

    gl.uniformMatrix4fv(projectionLoc, false, projection);

    const radius = Math.max(clothWidth, clothHeight) * 1.5; // orbit distance; doesn't affect apparent size in ortho, just view direction

    const targetX = centerX + camera.panX;
    const targetY = centerY + camera.panY;

    const eye = [
        targetX + radius * Math.sin(camera.phi) * Math.cos(camera.theta),
        targetY + radius * Math.cos(camera.phi),
        radius * Math.sin(camera.phi) * Math.sin(camera.theta)
    ];

    const view = Mat4.lookAt(eye, [targetX, targetY, 0], [0, 1, 0]);
    gl.uniformMatrix4fv(viewLoc, false, view);


    gl.bindVertexArray(vao);

    gl.drawArrays(
        gl.LINES,
        0,
        lineCount
    );
}