/* motion kit — deterministic timeline helpers. Every visual must be a pure function of t. */
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const lerp=(a,b,p)=>a+(b-a)*p;
const P=(t,a,b)=>clamp((t-a)/(b-a));
const E={
  lin:p=>p,
  outExpo:p=>p>=1?1:1-Math.pow(2,-10*p),
  inExpo:p=>p<=0?0:Math.pow(2,10*p-10),
  inOutExpo:p=>p<=0?0:p>=1?1:p<.5?Math.pow(2,20*p-10)/2:(2-Math.pow(2,-20*p+10))/2,
  outCubic:p=>1-Math.pow(1-p,3),
  inCubic:p=>p*p*p,
  inOutCubic:p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2,
  outQuint:p=>1-Math.pow(1-p,5),
  inOutQuint:p=>p<.5?16*p*p*p*p*p:1-Math.pow(-2*p+2,5)/2,
  outBack:(p,s=1.6)=>1+(s+1)*Math.pow(p-1,3)+s*Math.pow(p-1,2),
  spring:p=>p>=1?1:1-Math.exp(-7*p)*Math.cos(11*p),
  bounce:p=>{const n=7.5625,d=2.75;if(p<1/d)return n*p*p;if(p<2/d)return n*(p-=1.5/d)*p+.75;if(p<2.5/d)return n*(p-=2.25/d)*p+.9375;return n*(p-=2.625/d)*p+.984375},
};
const tw=(t,a,b,e='outExpo')=>E[e](P(t,a,b));
/* pulse: 1 at t0 decaying to 0 (for impacts / flashes) */
const pulse=(t,t0,decay=6)=>t<t0?0:Math.exp(-(t-t0)*decay);
function rnd(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}}
/* deterministic camera shake: sum of impacts */
function shake(t,hits,amp=18,decay=9){let x=0,y=0;for(const h of hits){const k=pulse(t,h,decay)*amp;x+=Math.sin((t-h)*83)*k;y+=Math.cos((t-h)*71)*k}return{x,y}}

function el(tag,cls,parent,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;(parent||document.getElementById('world')).appendChild(e);return e}
/* put: 2D/3D transform + opacity + blur. keys: x,y,z,s,sx,sy,r(rotZ),rx,ry,o,blur */
function put(e,o){
  let tr=`translate3d(${(o.x||0).toFixed(2)}px,${(o.y||0).toFixed(2)}px,${(o.z||0).toFixed(2)}px)`;
  if(o.rx)tr+=` rotateX(${o.rx.toFixed(3)}deg)`;
  if(o.ry)tr+=` rotateY(${o.ry.toFixed(3)}deg)`;
  if(o.r)tr+=` rotate(${o.r.toFixed(3)}deg)`;
  tr+=` scale(${(o.sx??o.s??1).toFixed(4)},${(o.sy??o.s??1).toFixed(4)})`;
  e.style.transform=tr;
  const op=o.o??1;
  e.style.opacity=op.toFixed(3);
  e.style.filter=o.blur>0.05?`blur(${o.blur.toFixed(2)}px)`:'';
  e.style.visibility=op<=0.002?'hidden':'visible';
}
const show=(e,on)=>{e.style.display=on?'':'none';return on};
/* SVG path length cache + partial draw [a,b] as fractions of length */
const _len=new WeakMap();
function drawPath(p,a,b){let L=_len.get(p);if(L==null||p.dataset.d!==p.getAttribute('d')){L=p.getTotalLength();_len.set(p,L);p.dataset.d=p.getAttribute('d')}
  a=clamp(a);b=clamp(b);const seg=Math.max(0,(b-a)*L);p.style.strokeDasharray=`${seg} ${L+10}`;p.style.strokeDashoffset=(-a*L);p.style.opacity=seg<0.5?0:1;return L}
