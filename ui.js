
function updateBendStiffness(val,whichParam){
    if(bendStiffness.locked){
        bendStiffness.x = val;
        bendStiffness.y = val;
        bendStiffness.diagonal = val;
        document.getElementById(`bend_stiffness_x`).value = val;
        document.getElementById(`bend_stiffness_y`).value = val;
        document.getElementById(`bend_stiffness_diagonal`).value = val;
    }
    else{
        bendStiffness[whichParam] = val;
    }
}

function toggleBendStiffnessLock(){
    bendStiffness.locked = !bendStiffness.locked;
}


function resetWind(id){
    wind = {
        x : 0,
        y : 0,
        z : 0.0
    };
    setUISliderValue(id,0);
}

function setTool(which){
    document.getElementById(`tool_button_${brush}`).style.outline = null;
    brush = which;
    document.getElementById(`tool_button_${brush}`).style.outline = "2px solid blue";
}

function setUISliderValue(id,val){
    document.getElementById(id).value = val;
}