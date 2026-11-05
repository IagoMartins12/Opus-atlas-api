/**
 * O link do compositor no IMSLP. Alguns cadastros (Satie, vindo da carga do
 * IMSLP) têm só o `imslpId` ("Category:Satie,_Erik") e o campo `permLinkImslp`
 * vazio: sem o link, o "Importar obras do IMSLP" não aparecia no admin nem no
 * cartão do usuário. A categoria dá o mesmo endereço.
 */
export function imslpComposerLink(
  permLink?: string | null,
  imslpId?: string | null,
): string | null {
  const link = permLink?.trim();
  if (link) return link;
  const id = imslpId?.trim();
  if (!id?.startsWith('Category:')) return null;
  return `https://imslp.org/wiki/${encodeURI(id.replace(/ /g, '_'))}`;
}
