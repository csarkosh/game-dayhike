uint extractBits(uint value,int offset,int width) {return (value>>offset) & ((1u<<width)-1u);
}