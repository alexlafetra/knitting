const Mat4 = {

identity() {
    return new Float32Array([
        1,0,0,0,
        0,1,0,0,
        0,0,1,0,
        0,0,0,1
    ]);
},
ortho(left, right, bottom, top, near, far) {

    const out = new Float32Array(16);

    out[0] = 2 / (right - left);
    out[5] = 2 / (top - bottom);
    out[10] = -2 / (far - near);

    out[12] = -(right + left) / (right - left);
    out[13] = -(top + bottom) / (top - bottom);
    out[14] = -(far + near) / (far - near);

    out[15] = 1;

    return out;
},
perspective(fov, aspect, near, far){

    const f = 1 / Math.tan(fov * 0.5);

    const out = new Float32Array(16);

    out[0] = f / aspect;
    out[5] = f;

    out[10] = (far + near) / (near - far);
    out[11] = -1;

    out[14] = (2 * far * near) / (near - far);

    return out;
},
normalize(v){

    const l = Math.hypot(v[0],v[1],v[2]);

    return [

        v[0]/l,
        v[1]/l,
        v[2]/l

    ];

},
subtract(a,b){

    return [
        a[0]-b[0],
        a[1]-b[1],
        a[2]-b[2]
    ];

},

cross(a,b){

    return [

        a[1]*b[2]-a[2]*b[1],
        a[2]*b[0]-a[0]*b[2],
        a[0]*b[1]-a[1]*b[0]

    ];

},
lookAt(eye,target,up){

    const z = this.normalize(
        this.subtract(eye,target)
    );

    const x = this.normalize(
        this.cross(up,z)
    );

    const y = this.cross(z,x);

    const out = new Float32Array(16);

    out[0]=x[0];
    out[1]=y[0];
    out[2]=z[0];
    out[3]=0;

    out[4]=x[1];
    out[5]=y[1];
    out[6]=z[1];
    out[7]=0;

    out[8]=x[2];
    out[9]=y[2];
    out[10]=z[2];
    out[11]=0;

    out[12]=-(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]);
    out[13]=-(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]);
    out[14]=-(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]);
    out[15]=1;

    return out;

}
};


