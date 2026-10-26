"""Bounded, reviewed public-content presentation corrections. Captured sources stay immutable."""
import re


def repair_public_contact_links(node, route, prefix='', in_footer=False, in_link=False):
    """Fix QA52/57 presentation links without rewriting the captured source corpus.

    Only the published business email is linked, only in legal documents or an
    inherited footer. Existing anchors remain intact. The known mislabelled
    article footer destination is corrected by exact label, class and old path.
    Existing company legal groups also receive the missing deletion-instructions link.
    """
    if not isinstance(node, dict):
        return
    attrs = node.get('attributes', {})
    classes = attrs.get('class', '').split()
    in_footer = in_footer or bool({'section-30', 'section-footer-dm'}.intersection(classes))
    is_link = node.get('tag') == 'a'
    if is_link and in_footer and 'link-3' in classes:
        def text(value):
            return ''.join(text(c) for c in value.get('children', [])) if isinstance(value, dict) else value
        if (text(node).strip() == 'Delete Account'
                and attrs.get('href') == prefix + '/documents/dm-terms-and-conditions-of-use'):
            attrs['href'] = prefix + '/documents/emtalk-delete-your-account-and-associated-data'
    linkable = (route.startswith('/documents/') or in_footer) and not (in_link or is_link)
    children = []
    for child in node.get('children', []):
        if isinstance(child, str) and linkable:
            # No arbitrary address recognition, external host or user input.
            for piece in re.split(r'(?<![A-Za-z0-9._+@-])(info@emtalk[.]org)(?![A-Za-z0-9._+@-])', child):
                if piece == 'info@emtalk.org':
                    children.append({'tag': 'a', 'attributes': {'href': 'mailto:info@emtalk.org', 'class': 'public-contact-email'},
                                     'children': [piece], 'void': False})
                elif piece:
                    children.append(piece)
        else:
            repair_public_contact_links(child, route, prefix, in_footer, in_link or is_link)
            children.append(child)
    if in_footer and 'legal' in classes:
        anchors = [child for child in children if isinstance(child, dict) and child.get('tag') == 'a']
        hrefs = {child.get('attributes', {}).get('href') for child in anchors}
        company_pair = {prefix + '/documents/emtalk-privacy-policy',
                        prefix + '/documents/emtalk-terms-and-conditions-of-use'}
        deletion = prefix + '/documents/emtalk-delete-your-account-and-associated-data'
        if company_pair.issubset(hrefs) and deletion not in hrefs:
            children.append({'tag': 'a', 'attributes': {'class': 'link-3', 'href': deletion},
                             'children': ['Delete Account'], 'void': False})
    if in_footer and 'legal' in classes and not any(isinstance(c, dict) and c.get('attributes', {}).get('href') == prefix + '/news' for c in children):
        # This authored AST link mirrors native-link-focus.html's documented
        # tabindex=0 WebKit policy; keep both owners aligned when changing it.
        children.append({'tag':'a','attributes':{'class':'link-3','href':prefix + '/news','tabindex':'0'},'children':['News'],'void':False})
    node['children'] = children
