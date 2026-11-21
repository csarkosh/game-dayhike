let chop=oceanWindAmp(p)*(1.0-sum.foam.y)*oceanShelter(p,SHELTER_CHOP);
  o.disp=sum.disp+oceanWindDisplaceAt(p,cell)*chop;
