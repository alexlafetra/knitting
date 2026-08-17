
glsl = x => x;

const vertShader = ``+glsl`#version 300 es

precision highp float;

layout(location=0) in vec2 aCoord;
layout(location=1) in vec2 aOtherCoord;

uniform sampler2D positionTex;
uniform sampler2D initialPositionTexture;
uniform sampler2D curvatureTexture;
uniform mat4 projection;
uniform mat4 view;
uniform float scale;

out float vStretch;
out vec4 vColor;

vec4 fetchTargetCurvature(ivec2 coord, ivec2 dims){
    vec4 originalStartingCoords = texelFetch(initialPositionTexture,coord,0);
    // convert world-space initial loc coords to uv to read from the texture
    vec2 uv = originalStartingCoords.xy / (vec2(dims - 1) * scale);

    return texture(curvatureTexture, uv);
}

void main() {
    vec3 currentPos = texelFetch(positionTex, ivec2(aCoord), 0).xyz;
    vec3 currentPos_other = texelFetch(positionTex, ivec2(aOtherCoord), 0).xyz;
    vec3 initialPos = texelFetch(initialPositionTexture, ivec2(aCoord), 0).xyz;
    vec3 initialPos_other = texelFetch(initialPositionTexture, ivec2(aOtherCoord), 0).xyz;
    float currentDist = length(currentPos - currentPos_other);

    float initialDistance = length(initialPos - initialPos_other); // handles straight (1,0) and diagonal (1,1) automatically

    vStretch = currentDist / initialDistance; // 1.0 = rest length, >1 = stretched, <1 = compressed
    ivec2 dims = textureSize(initialPositionTexture,0);
    vColor = fetchTargetCurvature(ivec2(aCoord),dims);

    gl_Position = projection * view * vec4(currentPos, 1.0) + vec4(0.75,-0.75,0.0,0.0);
}
`;

const renderFragShader = ``+glsl`#version 300 es

precision highp float;

in float vStretch;
in vec4 vColor;
out vec4 outColor;

// Converts RGB to HSL
vec3 rgb2hsl(vec3 c) {
    float maxVal = max(max(c.r, c.g), c.b);
    float minVal = min(min(c.r, c.g), c.b);
    float d = maxVal - minVal;
    
    float h = 0.0;
    float s = 0.0;
    float l = (maxVal + minVal) / 2.0;

    if (d > 0.0) {
        s = l > 0.5 ? d / (2.0 - maxVal - minVal) : d / (maxVal + minVal);
        if (maxVal == c.r) {
            h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
        } else if (maxVal == c.g) {
            h = (c.b - c.r) / d + 2.0;
        } else {
            h = (c.r - c.g) / d + 4.0;
        }
        h /= 6.0;
    }
    return vec3(h, s, l);
}

// Converts HSL to RGB
vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main(){
    if(vColor.a <= 0.01){
        outColor = vec4(0.0,0.0,0.0,1.0);
        return;
    }

    // map stretch ratio to color: blue-ish when compressed, white at rest, red when stretched
    float t = clamp(1.2 - vStretch/1.8, 0.0 , 1.0); // roughly -1..1 around rest length

    // vec3 color = hsl2rgb(vec3((1.0 - t)*10.0, 1.0, 0.5));
    //0 is red, 1.0 is red, 0.5 is cyan
    //when t is 0, it's very relaxed
    //when t is 1, it's perfect,
    //when t is 2, it's stretched
    vec3 color = hsl2rgb(vec3(t, 1.0, 0.5));
    outColor = vec4(color, 1.0);
    // outColor = vColor;
}`;


const quadVertShader = ``+glsl`#version 300 es
    layout(location=0) in vec2 aCoord;
    void main(){
        gl_Position = vec4(aCoord, 0.0, 1.0);
    }
`;

const verletFragShader = ``+glsl`#version 300 es

precision highp float;

uniform sampler2D positionTex;
uniform sampler2D previousTex;
uniform float damping;

out vec4 outColor;

void main() {

    ivec2 coord = ivec2(gl_FragCoord.xy);

    vec3 pos =
        texelFetch(positionTex, coord, 0).xyz;

    vec3 prev =
        texelFetch(previousTex, coord, 0).xyz;

    vec3 velocity =
        (pos - prev) * damping;

    vec3 next =
        pos +
        velocity;

    outColor =
        vec4(next,1.0);

}`;

const constraintFragShader = ``+glsl`#version 300 es
precision highp float;

uniform sampler2D positionTex;
uniform float initialLength;
uniform float initialLengthDiagonal;
uniform float uStiffness;
uniform float uContractionScale;
uniform float uExpansionScale;
uniform vec3 uBendStiffness; //x,y, and diagonal
uniform sampler2D curvatureTexture;
uniform sampler2D initialPositionTexture;
uniform vec3 uWind;
uniform float scale;

out vec4 outColor;

float signedDihedral(vec3 p1, vec3 p2, vec3 pWing, vec3 pOther, out vec3 nWing){
    vec3 edge = p2 - p1;
    nWing = normalize(cross(edge, pWing - p1));
    vec3 nOther = normalize(cross(edge, pOther - p1));
    float cosA = clamp(dot(nWing, nOther), -1.0, 1.0);
    float sinA = dot(cross(nWing, nOther), normalize(edge));
    return atan(sinA, cosA); // signed, stable near 0 and pi
}

vec3 bendWing(ivec2 hingeACoord, ivec2 hingeBCoord, ivec2 otherWingCoord, vec3 wingPos, ivec2 dims, float stiffness, inout float count){
    if (any(lessThan(hingeACoord, ivec2(0))) || any(greaterThanEqual(hingeACoord, dims))) return vec3(0.0);
    if (any(lessThan(hingeBCoord, ivec2(0))) || any(greaterThanEqual(hingeBCoord, dims))) return vec3(0.0);
    if (any(lessThan(otherWingCoord, ivec2(0))) || any(greaterThanEqual(otherWingCoord, dims))) return vec3(0.0);

    vec3 p1 = texelFetch(positionTex, hingeACoord, 0).xyz;
    vec3 p2 = texelFetch(positionTex, hingeBCoord, 0).xyz;
    vec3 pOther = texelFetch(positionTex, otherWingCoord, 0).xyz;

    vec3 edge = p2 - p1;
    float edgeLen = length(edge);
    if (edgeLen < 0.000001) return vec3(0.0);

    vec3 nWing;
    float angle = signedDihedral(p1, p2, wingPos, pOther, nWing); // restAngle assumed 0 (flat rest state)

    count += 1.0;
    return -nWing * angle * stiffness * edgeLen;
}

vec4 fetchTargetCurvature(ivec2 coord, vec4 originalStartingCoords, ivec2 dims){
    // convert world-space initial loc coords to uv to read from the texture
    vec2 uv = originalStartingCoords.xy / (vec2(dims - 1) * scale);
    return texture(curvatureTexture, uv);
}

vec3 bendCorrection(vec3 pos, ivec2 coord, ivec2 dir, ivec2 dims, float bendStiffness, inout float bendCount){
    ivec2 coordPrev = coord - dir;
    ivec2 coordNext = coord + dir;

    if (coordPrev.x < 0 || coordPrev.y < 0 || coordPrev.x >= dims.x || coordPrev.y >= dims.y) return vec3(0.0);
    if (coordNext.x < 0 || coordNext.y < 0 || coordNext.x >= dims.x || coordNext.y >= dims.y) return vec3(0.0);

    vec3 prevPos = texelFetch(positionTex, coordPrev, 0).xyz;
    vec3 nextPos = texelFetch(positionTex, coordNext, 0).xyz;

    vec3 flatMidpoint = (prevPos + nextPos) * 0.5;

    bendCount += 1.0;
    return (flatMidpoint - pos) * bendStiffness;
}

vec3 constraintDelta(vec4 curvature, vec3 pos, ivec2 coord, ivec2 offset, float initialLen, ivec2 dims, inout float count){
    ivec2 nCoord = coord + offset;
    if (nCoord.x < 0 || nCoord.y < 0 || nCoord.x >= dims.x || nCoord.y >= dims.y) {
        return vec3(0.0);
    }
    //the vertex 'B' loc, the other vert (pos is this vert)
    vec3 nPos = texelFetch(positionTex, nCoord, 0).xyz;
    //when fully 1.0, it should be big
    //when 0, it should be small
    //when 0.5, it should be == 1.0
    float targetRestLength = initialLen * curvature.r * uExpansionScale;

    vec3 delta = nPos - pos;
    float currentLength = length(delta);
    if (currentLength < 0.00001)
        return vec3(0.0);
    float diff = currentLength - targetRestLength;
    vec3 correction = delta * (diff / currentLength);
    count += 1.0;
    return correction;
}

void main(){
    ivec2 coord = ivec2(gl_FragCoord.xy);
    ivec2 dims = textureSize(positionTex, 0);
    vec4 data = texelFetch(positionTex, coord, 0);
    vec3 pos = data.xyz;
    int supportSize = 50;
    int supportSpacing = 3;
    vec4 originalStartingCoords = texelFetch(initialPositionTexture,coord,0);
    vec4 curvature = fetchTargetCurvature(coord,originalStartingCoords,dims);

    // pin all edges
    //skip areas with transparent curvature! this is like the mask
    if ( curvature.a <= 0.01 || coord.y == dims.y - 1 || coord.y == 0 || coord.x == 0 || coord.x == dims.x - 1) {
    //pin corners
    // if((coord.y == 0 || coord.y == dims.y - 1) && (coord.x == 0 || coord.x == dims.x - 1)){
    //pin every N points along edge
    // if((coord.y % supportSpacing == 0) && (coord.x % supportSpacing == 0) && (coord.y == 0 || coord.x == 0 || coord.y == dims.y - 1 - dims.y%supportSpacing || coord.x == dims.x -1)){
        outColor = vec4(originalStartingCoords.xyzw);
        return;
    }

    float count = 0.0;
    vec3 correction = vec3(0.0);


    correction += constraintDelta(curvature, pos, coord, ivec2( 1, 0), initialLength, dims, count);
    correction += constraintDelta(curvature, pos, coord, ivec2(-1, 0), initialLength, dims, count);
    correction += constraintDelta(curvature, pos, coord, ivec2( 0, 1), initialLength, dims, count);
    correction += constraintDelta(curvature, pos, coord, ivec2( 0,-1), initialLength, dims, count);

    correction += constraintDelta(curvature, pos, coord, ivec2( 1, 1), initialLengthDiagonal, dims, count);
    correction += constraintDelta(curvature, pos, coord, ivec2(-1, 1), initialLengthDiagonal, dims, count);
    correction += constraintDelta(curvature, pos, coord, ivec2( 1,-1), initialLengthDiagonal, dims, count);
    correction += constraintDelta(curvature, pos, coord, ivec2(-1,-1), initialLengthDiagonal, dims, count);

    vec3 next = pos;
    if (count > 0.0) {
        next = pos + (correction / count) * uStiffness + uWind;
    }

    ivec2 c = coord;
    float bendCount = 0.0;
    vec3 bend = vec3(0.0);

    // --- diagonal hinges ---
    bend += bendWing(c+ivec2(-1,0), c+ivec2(0,1),  c+ivec2(-1,1),  pos, dims, uBendStiffness.z, bendCount);
    bend += bendWing(c+ivec2(0,-1), c+ivec2(1,0),  c+ivec2(1,-1),  pos, dims, uBendStiffness.z, bendCount);

    // --- horizontal-edge hinges (bend resistance along X) ---
    bend += bendWing(c+ivec2(-1,-1), c+ivec2(0,-1), c+ivec2(-1,-2), pos, dims, uBendStiffness.x, bendCount);
    bend += bendWing(c+ivec2(0,1),   c+ivec2(1,1),  c+ivec2(1,2),   pos, dims, uBendStiffness.x, bendCount);

    // --- vertical-edge hinges (bend resistance along Y) ---
    bend += bendWing(c+ivec2(-1,-1), c+ivec2(-1,0), c+ivec2(-2,-1), pos, dims, uBendStiffness.y, bendCount);
    bend += bendWing(c+ivec2(1,0),   c+ivec2(1,1),  c+ivec2(2,1),   pos, dims, uBendStiffness.y, bendCount);

    if (bendCount > 0.0) {
        next += bend / bendCount; // same normalization lesson as before — don't skip this
    }

    // float bendCount = 0.0;
    // vec3 bend = vec3(0.0);

    // bend += bendCorrection(pos, coord, ivec2(1, 0), dims, uBendStiffness.x, bendCount); // horizontal axis
    // bend += bendCorrection(pos, coord, ivec2(0, 1), dims, uBendStiffness.y, bendCount); // vertical axis

    // // optional: bend resistance along the diagonal weave too
    // bend += bendCorrection(pos, coord, ivec2(1, 1),  dims, uBendStiffness.z, bendCount);
    // bend += bendCorrection(pos, coord, ivec2(1, -1), dims, uBendStiffness.z, bendCount);

    // if (bendCount > 0.0) {
    //     next += bend / bendCount;
    // }

    vec3 totalCorrection = (correction / max(count, 1.0)) * uStiffness + bend / max(bendCount, 1.0);

    float maxStep = initialLength * 1.0; // tune: fraction of rest length allowed to move per iteration
    float stepLen = length(totalCorrection);
    if (stepLen > maxStep) {
        totalCorrection *= maxStep / stepLen;
    }

    next = pos + totalCorrection + uWind;

    outColor = vec4(next, data.w);
    // outColor = vec4(1.0);
}
`;