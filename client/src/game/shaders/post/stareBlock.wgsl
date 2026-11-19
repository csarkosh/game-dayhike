  if(u.stareShade.z>0.0){
    let sp=centred-u.stareShade.xy;
    let sa=atan2(sp.y,sp.x);
    let st=u.stareShade.w;
    let crawl=0.5*sin(sa*2.0+st*0.37)+0.3*sin(sa*3.0-st*0.56+1.7)+0.2*sin(sa*7.0+st*0.94+4.1);
    let sr=length(sp)/1.41421356+crawl*0.11*u.stareShade.z;
    let openTo=mix(1.25,0.3,u.stareShade.z);
    let dark=smoothstep(openTo-0.42,openTo+0.14,sr)*min(1.0,u.stareShade.z*3.0);
    c*=1.0-0.97*dark;
  }
