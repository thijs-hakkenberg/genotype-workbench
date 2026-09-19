/** Hash routes: #/overview, #/genome/2:136600000-136620000?sel=…, #/kits, #/packs, #/plugins, #/import, #/clinvar */
export const route = $state({ page: 'overview', arg: '', params: new URLSearchParams() });

function parse() {
  const hash = location.hash.replace(/^#\/?/, '') || 'overview';
  const [path = 'overview', query = ''] = hash.split('?');
  const [page = 'overview', ...rest] = path.split('/');
  route.page = page;
  route.arg = decodeURIComponent(rest.join('/'));
  route.params = new URLSearchParams(query);
}

parse();
window.addEventListener('hashchange', parse);

export function go(path: string, replace = false) {
  const url = `#/${path.replace(/^#?\/?/, '')}`;
  if (replace) {
    history.replaceState(null, '', url);
    parse();
  } else location.hash = url;
}
