// Rewrites material-components-web 0.37 SCSS so that Dart Sass >= 1.92 emits the same CSS
// as older Sass did.
//
// Old Sass hoisted every declaration of a style rule above that rule's nested rules, even
// when the declaration was written (or emitted by a mixin) after a nested rule. Sass 1.92
// emits them in source order instead, which reorders the cascade (e.g. `.mdc-slider` would
// override `.mdc-slider--disabled`). MDC relies on the old behavior in ~380 places, mostly
// through mixins, so the declarations can't simply be moved by hand.
//
// Each style rule body is evaluated twice instead: a `decls` pass that only emits
// declarations and a `rules` pass that only emits nested rules. Declarations, comments and
// nested blocks are guarded by `$mdc-sass-phase_`; `!global` side effects (e.g. keyframe uid
// counters) only run once. Outside MDC's own rules the phase is `all`, so mixins called from
// application styles behave as before.
import postcss from 'postcss';
import scss from 'postcss-scss';

const PHASE = '$mdc-sass-phase_';
const DEPTH = '$mdc-sass-depth_';
const OWN = Symbol('mdc-sass-own');
// Outside every patched block the phase is `all`; inside one we are in its `rules` pass.
const RESTORE = `@if ${DEPTH} == 0 { ${PHASE}: all !global; } @else { ${PHASE}: rules !global; }`;

const SASS_DIRECTIVES = new Set(['if', 'else', 'each', 'for', 'while', 'mixin', 'function', 'include', 'content']);
// Blocks that produce their own CSS block nested in the parent: style rules, @at-root and
// bubbling CSS at-rules (@media, @supports, @-moz-document, ...).
const isBlock = (n) => n.type === 'rule'
  || (n.type === 'atrule' && n.nodes && !SASS_DIRECTIVES.has(n.name) && !isOpaque(n));
// Emitted as a nested child, but its contents are not style-rule children.
const isOpaque = (n) => n.type === 'atrule' && (/(^|-)keyframes$/.test(n.name) || ['font-face', 'page'].includes(n.name));
const isVariable = (n) => n.type === 'decl' && n.prop.startsWith('$');
const isEmitted = (n) => (n.type === 'decl' && !isVariable(n)) || (n.type === 'comment' && !n.raws.inline);

const guard = (condition, nodes) => {
  const at = postcss.atRule({name: 'if', params: `${PHASE} != ${condition}`, raws: {afterName: ' ', between: ' '}});
  at[OWN] = true;
  at.append(nodes);
  return at;
};
const own = (source) => {
  const nodes = scss.parse(source).nodes;
  nodes.forEach((n) => { n[OWN] = true; });
  return nodes;
};

function transformChildren(container, inStyle) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length) { out.push(guard('rules', run)); run = []; } };

  for (const node of [...container.nodes]) {
    node.remove();
    if (node[OWN]) { flush(); out.push(node); continue; }
    if (isEmitted(node) && (inStyle || node.type === 'decl')) { run.push(node); continue; }
    if (node.type === 'comment' && node.raws.inline && run.length) { run.push(node); continue; }
    flush();
    if (isVariable(node) && /!global\b/.test(node.value)) {
      out.push(guard('rules', [node]));
    } else if (isOpaque(node)) {
      // emitted with the nested rules, but its own declarations (often from mixins) must all be kept
      out.push(inStyle ? guard('decls', [...own(`${PHASE}: all !global;`), node, ...own(RESTORE)]) : node);
    } else if (isBlock(node)) {
      transformChildren(node, true);
      const body = [...node.nodes];
      body.forEach((n) => n.remove());
      const each = postcss.atRule({name: 'each', params: '$mdc-sass-pass_ in decls, rules', raws: {afterName: ' ', between: ' '}});
      each[OWN] = true;
      each.append(own(`${PHASE}: $mdc-sass-pass_ !global;`));
      each.append(body);
      node.append(own(`${DEPTH}: ${DEPTH} + 1 !global;`));
      node.append(each);
      node.append(own(`${DEPTH}: ${DEPTH} - 1 !global;\n${RESTORE}`));
      out.push(guard('decls', [node]));
    } else {
      if (node.nodes) {
        // functions, mixins, control flow and @include content blocks
        const style = inStyle || (node.type === 'atrule' && ['mixin', 'include', 'content'].includes(node.name));
        if (node.type === 'atrule' && node.name === 'function') transformFunction(node);
        else transformChildren(node, style);
      }
      out.push(node);
    }
  }
  flush();
  container.append(out);
}

// Functions emit nothing; only their global side effects need to run once.
function transformFunction(fn) {
  fn.walkDecls((d) => {
    if (!isVariable(d) || !/!global\b/.test(d.value) || d[OWN]) return;
    const copy = d.clone();
    copy[OWN] = true;
    d.replaceWith(guard('rules', [copy]));
  });
}

export function transform(source) {
  const root = scss.parse(source);
  transformChildren(root, false);
  // State lives in globals declared by every file (they are @import-ed, never @use-d).
  const header = own(`${PHASE}: all !default;\n${DEPTH}: 0 !default;`);
  const lastUse = root.nodes.findLastIndex((n) => n.type === 'atrule' && ['use', 'forward', 'charset'].includes(n.name));
  if (lastUse >= 0) root.nodes[lastUse].after(header); else root.prepend(header);
  // Moved nodes lose their leading whitespace; a `//` comment must still end its line.
  const lineBreaks = (container) => {
    for (const n of container.nodes) {
      if (!/\n/.test(n.raws.before ?? '')) n.raws.before = '\n';
      if (n.nodes) lineBreaks(n);
    }
    if (!/\n/.test(container.raws.after ?? '')) container.raws.after = '\n';
  };
  lineBreaks(root);
  return root.toString(scss.stringify);
}
