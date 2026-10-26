"""Finite Tapl discovery content, local state and registry output contracts."""
import json
import hashlib
import tinycss2
from urllib.parse import urlsplit
from pathlib import Path
import re

from bs4 import BeautifulSoup

def _check_tapl_discovery_chapters(quest, errors):
    statuses = quest.select('[data-tapl-selection-status][role="status"][aria-live="polite"][aria-atomic="true"]')
    if len(statuses) != 1:
        errors.append('Tapl contract: one atomic local choice status required')
    chapters = quest.select('[data-tapl-chapter]')
    if [chapter.get('data-tapl-chapter') for chapter in chapters] != ['0', '1', '2', '3', '4']:
        errors.append('Tapl contract: finite five-chapter order differs')
    for index, chapter in enumerate(chapters, 1):
        if chapter.get('id') != 'tapl-chapter-' + str(index) or len(chapter.select('h3[tabindex="-1"]')) != 1:
            errors.append('Tapl contract: chapter heading/destination semantics differ')
        heading = chapter.select_one('h3[tabindex="-1"]')
        if heading and any(not heading.get(key, '').strip() for key in
                           ('data-tapl-personal-title', 'data-tapl-business-title', 'data-tapl-partner-title')):
            errors.append('Tapl contract: every chapter requires personal/business/partner titles')
        if chapter.has_attr('hidden'):
            errors.append('Tapl contract: discovery content must remain available without JS')
    indicators = quest.select('[data-tapl-step-indicator]')
    if [node.get('data-tapl-step-indicator') for node in indicators] != ['0', '1', '2', '3', '4']:
        errors.append('Tapl contract: native discovery progress list differs')
    if len(quest.select('nav[aria-label="Tapl discovery steps"] ol > li')) != 5:
        errors.append('Tapl contract: discovery progress requires a native named list')
    positions = quest.select('[data-tapl-quest-position]')
    initial_position = 'Five chapters to explore'
    if len(positions) != 1 or positions[0].get_text(' ', strip=True) != initial_position:
        errors.append('Tapl contract: initial discovery position differs')
    if any(not node.has_attr('hidden') for node in quest.select('[data-tapl-enhanced]')):
        errors.append('Tapl contract: enhanced-only controls must start hidden')
    return chapters


def _check_tapl_sample_programs(quest, errors):
    personal_keys = ['running', 'language', 'weight', 'time']
    program_keys = personal_keys + ['business', 'partner']
    programs = quest.select('[data-tapl-goal-program]')
    choices = quest.select('button[data-tapl-goal-choice]')
    if ([node.get('data-tapl-goal-program') for node in programs] != program_keys or
            [node.get('data-tapl-goal-choice') for node in choices] != personal_keys):
        errors.append('Tapl contract: finite personal/work example scope differs')
    if any(node.has_attr('hidden') for node in programs):
        errors.append('Tapl contract: all illustrative programs remain readable without JS')
    if [node.get('data-tapl-goal-choice') for node in choices if node.get('aria-pressed') == 'true'] != ['language']:
        errors.append('Tapl contract: language is the explicit personal example default')
    for program in programs:
        required = ('data-tapl-goal-program-title', 'data-tapl-goal-explanation', 'data-tapl-goal-metric',
                    'data-tapl-goal-summary', 'data-tapl-support-source', 'data-tapl-smaller-task-source', 'data-tapl-smaller-note-source')
        if not program.get('data-tapl-goal-label') or any(
                len(program.select('[' + key + ']')) != 1 or not program.select_one('[' + key + ']').get_text(strip=True)
                for key in required):
            errors.append('Tapl contract: example metadata must be complete')
        weeks = program.select('[data-tapl-program-week]')
        if [node.get('data-tapl-program-week') for node in weeks] != ['1', '2']:
            errors.append('Tapl contract: every example requires two finite sample weeks')
        for week in weeks:
            for key in ('data-tapl-goal-task', 'data-tapl-goal-task-note'):
                if len(week.select('[' + key + ']')) != 3 or any(not node.get_text(strip=True) for node in week.select('[' + key + ']')):
                    errors.append('Tapl contract: sample week requires three tasks and notes')
        if program.get('data-tapl-goal-program') in {'business','partner'}:
            expected_actors = (['Course owner','Employee','Owner + team'] if program.get('data-tapl-goal-program') == 'business'
                               else ['Creator','Learner','Creator + learner'])
            for week in weeks:
                if [node.get_text(strip=True) for node in week.select('[data-tapl-task-actor-source]')] != expected_actors:
                    errors.append('Tapl contract: pilot task actors must be explicit and finite')
            if len(program.select('.tapl-creator-steps > li')) != 4 or any(node.get('aria-hidden') != 'true' for node in program.select('.tapl-flow-number')):
                errors.append('Tapl contract: reviewed creator flow and decorative numbers differ')
        phases = program.select('[data-tapl-phase-source]')
        if [node.get('data-tapl-phase-source') for node in phases] != ['0','1','2'] or any(not node.get_text(strip=True) for node in phases):
            errors.append('Tapl contract: three illustrative milestones required per example')
    references = quest.select('[data-tapl-goal-reference]')
    if len(references) != 6 or any(node.name != 'details' or node.has_attr('open') or node.has_attr('hidden') or not node.select_one(':scope > summary') for node in references):
        errors.append('Tapl contract: six original sample references must be collapsed native disclosures')
    language = quest.select_one('[data-tapl-goal-program="language"]')
    if language:
        week1 = language.select_one('[data-tapl-program-week="1"]')
        if week1:
            for source_key, target_key in (('data-tapl-goal-task', 'data-tapl-task-text'), ('data-tapl-goal-task-note', 'data-tapl-task-note')):
                sources = [node.get_text(strip=True) for node in week1.select('[' + source_key + ']')]
                targets = quest.select('[' + target_key + ']')
                if [node.get(target_key) for node in targets] != ['0','1','2'] or [node.get_text(strip=True) for node in targets] != sources:
                    errors.append('Tapl contract: SSR week must match language week1')
        for source_key, target_key in (('data-tapl-goal-summary', 'data-tapl-goal-summary-view'), ('data-tapl-smaller-task-source', 'data-tapl-generated-task'), ('data-tapl-smaller-note-source', 'data-tapl-generated-note')):
            source = language.select_one('[' + source_key + ']')
            targets = quest.select('[' + target_key + ']')
            if not source or len(targets) != 1 or targets[0].get_text(strip=True) != source.get_text(strip=True):
                errors.append('Tapl contract: SSR summary/smaller step differs from language example')
    return language


def _check_tapl_reference_assets(main, prefix, errors):
    references = main.select('.tapl-references > details')
    if len(references) != 2 or any(node.has_attr('open') for node in references):
        errors.append('Tapl contract: two optional references must start collapsed')
    if len(main.select('.tapl-faq details > summary')) != 14 or len(main.select('.tapl-faq details > p')) != 14:
        errors.append('Tapl contract: native FAQ questions/answers differ')
    if len(main.select('.tapl-creator-flow > li')) != 5:
        errors.append('Tapl contract: planned creator reference requires five steps')
    for target in ('tapl-quest', 'tapl-details'):
        if len(main.select('#' + target)) != 1 or not main.select('a[href="#' + target + '"]'):
            errors.append('Tapl contract: native destination missing ' + target)
    geometry = {'calendar.webp': ('140', '140'), 'statistics.webp': ('140', '140'),
                'target-circle.svg': ('140', '140'), 'calendar-icon.svg': ('32', '32'),
                'target-icon.svg': ('20', '20'), 'statistics-icon.svg': ('32', '32'),
                'goal-circle.svg': ('794', '794'), 'onboarding-path.svg': ('336', '196')}
    actual = main.select('img')
    for name, size in geometry.items():
        images = [img for img in actual if img.get('src') == prefix + '/media/tapl/' + name]
        if len(images) != 1 or any((img.get('width'), img.get('height')) != size for img in images):
            errors.append('Tapl contract: exact native asset slot differs ' + name)
    if len(actual) != 8:
        errors.append('Tapl contract: unexpected image asset')


def _check_tapl_feedback_scope(main, quest, allowed_features, role_audiences, all_audiences, default_audience, errors):
    role_buttons = quest.select('button[data-tapl-audience][data-tapl-feature]')
    if len(role_buttons) != len(role_audiences) or {b.get('data-tapl-audience') for b in role_buttons} != role_audiences:
        errors.append('Tapl contract: audience choices differ from configured scope')
    if any(button.get('data-tapl-audience') not in role_audiences for button in quest.select('[data-tapl-audience]')):
        errors.append('Tapl contract: local audience choice not allowed by registry')
    used_features = {b.get('data-tapl-feature') for b in role_buttons} | {b.get('data-interest-feature') for b in main.select('[data-interest-open]')}
    if not used_features <= allowed_features:
        errors.append('Tapl contract: contextual feedback key not allowed by registry')
    if not allowed_features <= used_features:
        errors.append('Tapl contract: configured contextual scope missing from discovery')
    if any(not node.attrs and not node.get_text(strip=True) and not node.find() for node in main.select('p')):
        errors.append('Tapl contract: unannotated empty paragraph nodes must not be authored')
    mobile_refs = main.select('[data-tapl-mobile-upcoming]')
    if len(mobile_refs) != 1 or mobile_refs[0].get_text(strip=True) != 'Later: Wednesday (sample)':
        errors.append('Tapl contract: compact mobile original-week reference required')
    interests = quest.select('[data-tapl-interest][data-interest-open]')
    if len(interests) != 1 or interests[0].get('data-interest-audience') != default_audience:
        errors.append('Tapl contract: initial interest audience must use configured optional default')
    if any(button.get('data-interest-audience') not in all_audiences for button in main.select('[data-interest-audience]')):
        errors.append('Tapl contract: feedback audience not allowed by registry')
    return interests


def _check_tapl_hero_copy(main, language, errors):
    hero_caption = main.select_one('figcaption.tapl-visual-caption')
    if not hero_caption or 'Prepared sample Week 1' not in hero_caption.get_text():
        errors.append('Tapl contract: hero is labelled as a prepared week1 reference')
    hero_when = main.select('[data-tapl-hero-when]')
    if ([node.get('data-tapl-hero-when') for node in hero_when] != ['0','1'] or
            'Monday' not in hero_when[0].get_text() or 'Later this sample week' not in hero_when[1].get_text() or
            'Wednesday' not in hero_when[1].get_text()):
        errors.append('Tapl contract: Today and upcoming sample scheduling must be explicit')
    if language:
        first_week = language.select_one('[data-tapl-program-week="1"]')
        if first_week:
            for source_key, target_key in (('data-tapl-goal-task','data-tapl-hero-task'),('data-tapl-goal-task-note','data-tapl-hero-note')):
                expected = [node.get_text(strip=True) for node in first_week.select('[' + source_key + ']')][:2]
                if [node.get_text(strip=True) for node in main.select('[' + target_key + ']')] != expected:
                    errors.append('Tapl contract: SSR Today/upcoming tasks must match language week1')


def _check_tapl_support_controls(main, quest, chapters, interests, errors):
    if chapters and chapters[0].select('[data-tapl-audience]'):
        errors.append('Tapl contract: personal goals must not collect an audience answer')
    if len(quest.select('.tapl-story-switch [role="group"][aria-label="Choose an optional discovery story"]')) != 1:
        errors.append('Tapl contract: optional story switch requires a named native button group')
    if {node.get('data-tapl-week-choice') for node in quest.select('[data-tapl-week-choice]')} != {'1','2'}:
        errors.append('Tapl contract: two explicit sample week controls required')
    for selector in ('[data-tapl-less-time]', '[data-tapl-preview-adjusted]', '[data-tapl-show-generated]', '[data-tapl-use-generated]', '[data-tapl-celebrate]'):
        if len(quest.select(selector)) != 1:
            errors.append('Tapl contract: explicit support/generation/celebration control missing')
    for selector in ('[data-tapl-preview-adjusted]', '[data-tapl-show-generated]'):
        controls = quest.select(selector)
        if len(controls) != 1 or controls[0].get('aria-controls') != 'tapl-generated-step' or controls[0].has_attr('aria-expanded'):
            errors.append('Tapl contract: hidden suggestion controls require shared target without SSR expanded state')
    for key in ('data-tapl-milestones-details','data-tapl-sharing-details'):
        nodes = quest.select('details[' + key + ']')
        if len(nodes) != 1 or nodes[0].has_attr('open') or not nodes[0].select_one('summary'):
            errors.append('Tapl contract: detailed chapter reference requires a collapsed native disclosure')
    support_panels = quest.select('[data-tapl-support-panel]')
    if len(support_panels) != 1 or support_panels[0].has_attr('hidden') or not support_panels[0].select('[data-tapl-original-step]'):
        errors.append('Tapl contract: no-JS prepared difficulty and before/after example must remain readable')
    if any('goal' in attr for node in main.select('[data-interest-open]') for attr in node.attrs):
        errors.append('Tapl contract: example goal must not enter feedback attributes')
    if len(interests) == 1:
        labels = interests[0].select('[data-tapl-interest-label]')
        arrows = interests[0].select('[data-tapl-interest-arrow][aria-hidden="true"]')
        if len(labels) != 1 or not labels[0].get_text(strip=True) or len(arrows) != 1 or arrows[0].get_text(strip=True) != chr(0x2197):
            errors.append('Tapl contract: feedback label and retained decorative arrow must be explicit')


def _check_tapl_copy_defaults(main, quest, language, errors):
    if language:
        smaller = language.select_one('[data-tapl-smaller-task-source]')
        note = language.select_one('[data-tapl-smaller-note-source]')
        explanation = quest.select_one('[data-tapl-smaller-explanation]')
        if not smaller or not note or not explanation or explanation.get_text(strip=True) != 'Smaller week 2 example: ' + smaller.get_text(strip=True) + '. ' + note.get_text(strip=True):
            errors.append('Tapl contract: smaller task title/note require a clear separator')
    default_label = language.get('data-tapl-goal-label') if language else None
    default_copy = {
        '[data-tapl-hero-context]': default_label,
        '[data-tapl-selected-week-label]': f'Week 1 sample: {default_label}.',
        '[data-tapl-week-note]': 'Week 1 sample: Wednesday. No sample step marked complete.',
        '[data-tapl-recap]': 'Week 1 sample, exploring without an audience choice. No sample action marked complete; no task moved.',
    }
    for selector, expected in default_copy.items():
        nodes = main.select(selector)
        if not default_label or len(nodes) != 1 or nodes[0].get_text(strip=True) != expected:
            errors.append('Tapl contract: default SSR/enhanced copy mismatch: ' + selector)
    metric_fallback = quest.select_one('[data-tapl-goal-metric-view]')
    if not metric_fallback or metric_fallback.get_text(strip=True) != 'A planned example metric, not a value calculated by marking the sample task. Program metrics would need their own suitable observations and review.':
        errors.append('Tapl contract: metric SSR and enhanced explanation must agree')


def _check_tapl_counters(main, quest, errors):
    checkboxes = quest.select('input')
    if (len(checkboxes) != 1 or checkboxes[0].get('type') != 'checkbox' or
            checkboxes[0].get('id') != 'tapl-sample-complete' or not checkboxes[0].has_attr('data-tapl-complete') or
            checkboxes[0].has_attr('name') or checkboxes[0].has_attr('checked') or
            checkboxes[0].find_parent(attrs={'data-tapl-enhanced': True}) is None):
        errors.append('Tapl contract: only the local unchecked sample checkbox is allowed')
    if main.select('form,textarea,input:not([data-tapl-complete])'):
        errors.append('Tapl contract: discovery must not collect uploads or personal text')
    if len(quest.select('[data-tapl-movable-task]')) != 1 or len(quest.select('.tapl-week-demo__day p')) != 3:
        errors.append('Tapl contract: fixed three-task example differs')
    if {b.get('data-tapl-day-choice') for b in quest.select('[data-tapl-day-choice]')} != {'wednesday', 'thursday'}:
        errors.append('Tapl contract: fixed day controls differ')
    for selector in ('[data-tapl-completed-count]', '[data-tapl-moved-count]'):
        nodes = quest.select(selector)
        if len(nodes) != 1 or nodes[0].get_text(strip=True) != '0':
            errors.append('Tapl contract: sample counters must start at zero')
    if len(quest.select('[data-tapl-back]')) != 1 or len(quest.select('[data-tapl-next]')) != 1 or len(quest.select('[data-tapl-restart]')) != 1:
        errors.append('Tapl contract: explicit discovery navigation missing')


def _check_tapl_fonts(soup, build, root, prefix, errors):
    """Tapl deliberately shares the immutable DM WOFF2 resources, not a copy.

    These two digests match the native DM delivery contract. Check this route
    independently so a generic Tapl-only build does not depend on a DM page.
    """
    expected = {
        '400': ('roboto_regular', 'eab3a43cb4c9bfe24c157a01fb91ae80fee90e64b5e08b01e8f0a4bace7f8558'),
        '500': ('roboto_medium', 'f150ce483e096530087b05528bcbe852a3f7d9253458f0165348182fdca8f2de'),
    }
    try:
        links = [urlsplit(node['href']) for node in soup.select('link[rel~="stylesheet"][href]')]
        owned = [link.path for link in links if not link.scheme and not link.netloc
                 and link.path.startswith(prefix + '/css/tapl.') and link.path.endswith('.css')]
        if len(owned) != 1:
            raise ValueError()
        sheet = (Path(build) / owned[0][len(prefix):].lstrip('/')).resolve()
        if not sheet.is_relative_to(Path(build).resolve()) or sheet.is_symlink():
            raise ValueError()
        faces = []
        for rule in tinycss2.parse_stylesheet(sheet.read_text(encoding='utf8'), skip_comments=True, skip_whitespace=True):
            if rule.type == 'at-rule' and rule.lower_at_keyword == 'font-face':
                values = {d.lower_name: tinycss2.serialize(d.value).strip().replace('"', '').replace("'", '')
                          for d in tinycss2.parse_declaration_list(rule.content) if d.type == 'declaration'}
                if values.get('font-family') == 'TaplRoboto':
                    faces.append(values)
        if len(faces) != 2:
            raise ValueError()
        for weight, (name, digest) in expected.items():
            face = [item for item in faces if item.get('font-weight') == weight]
            if (len(face) != 1 or face[0].get('src') != 'url(../fonts/dm/' + name + '.woff2) format(woff2)'
                    or face[0].get('font-display') != 'swap' or face[0].get('font-style', 'normal') != 'normal'):
                raise ValueError()
            for base in [Path(root) / 'static', Path(build)]:
                font = base / 'fonts/dm' / (name + '.woff2')
                if font.is_symlink() or hashlib.sha256(font.read_bytes()).hexdigest() != digest:
                    raise ValueError()
    except (OSError, ValueError, TypeError, KeyError):
        errors.append('Tapl contract: shared immutable WOFF2 font delivery differs')


def verify_tapl_landing(build, prefix='', *, root):
    """Finite discovery, operative registries and fail-closed source replacement."""
    root = Path(root)
    errors = []
    try:
        render = json.loads((root / 'data/render.json').read_text(encoding='utf-8'))
        page = render['pages']['/tapl']
        if page['body']['children'] != []:
            errors.append('Tapl contract: unexpected source AST children require reconciliation')
        registry = json.loads((root / 'data/interest-registry.json').read_text(encoding='utf-8'))
        configured = registry['pages']['/tapl']
        if (not isinstance(configured, list) or not configured or
                any(not isinstance(key, str) or not key for key in configured) or
                len(set(configured)) != len(configured) or 'page' not in configured):
            return errors + ['Tapl contract: malformed contextual feature registry']
        allowed_features = set(configured) - {'page'}
        audience_config = registry['audiences']
        options = audience_config['options']
        default_audience = audience_config['default']
        if (not isinstance(default_audience, str) or not default_audience or not isinstance(options, list) or
                any(not isinstance(option, dict) or not isinstance(option.get('value'), str) or
                    not option.get('value') or not isinstance(option.get('label'), str) or not option.get('label')
                    for option in options)):
            return errors + ['Tapl contract: malformed audience registry']
        values = [option['value'] for option in options]
        if len(set(values)) != len(values) or default_audience not in values:
            return errors + ['Tapl contract: duplicate audience or missing default']
        all_audiences = set(values)
        role_audiences = all_audiences - {default_audience}
        if not allowed_features or not role_audiences:
            return errors + ['Tapl contract: empty configured discovery scope']
        route_rows = json.loads((root / 'data/route-map.json').read_text(encoding='utf-8'))['routes']
        tapl_rows = [row for row in route_rows if isinstance(row, dict) and row.get('path') == '/tapl']
        if len(tapl_rows) != 1:
            return errors + ['Tapl contract: expected exactly one /tapl output in route-map']
        route_file = tapl_rows[0].get('file')
        if not isinstance(route_file, str) or not route_file or route_file.startswith('/') or '\\' in route_file or Path(route_file).is_absolute() or re.search(r'[:?#]', route_file) or '..' in Path(route_file).parts:
            return errors + ['Tapl contract: invalid /tapl output path in route-map']
        output = Path(build) / route_file
        if not output.is_file():
            return errors + ['Tapl contract: missing mapped /tapl output: ' + route_file]
        soup = BeautifulSoup(output.read_text(encoding='utf-8'), 'html.parser')
    except (OSError, ValueError, KeyError, TypeError):
        return errors + ['Tapl contract: missing or malformed source/output/registry']
    mains = soup.select('main[data-tapl-landing]')
    if len(mains) != 1 or len(soup.select('main')) != 1 or len(soup.select('h1')) != 1:
        return errors + ['Tapl contract: expected one authored main and h1']
    main = mains[0]
    _check_tapl_fonts(soup, build, root, prefix, errors)
    figures = main.select('figure.tapl-hero__visual')
    if len(figures) != 1 or len(figures[0].select('figcaption.tapl-visual-caption')) != 1:
        errors.append('Tapl contract: hero figure requires one visible caption')
    if 'In development' not in main.get_text(' ', strip=True):
        errors.append('Tapl contract: missing development status')
    quests = main.select('[data-tapl-quest]')
    if len(quests) != 1:
        return errors + ['Tapl contract: expected one discovery stage']
    quest = quests[0]
    chapters = _check_tapl_discovery_chapters(quest, errors)
    interests = _check_tapl_feedback_scope(main, quest, allowed_features, role_audiences, all_audiences, default_audience, errors)
    language = _check_tapl_sample_programs(quest, errors)
    _check_tapl_hero_copy(main, language, errors)
    _check_tapl_support_controls(main, quest, chapters, interests, errors)
    _check_tapl_copy_defaults(main, quest, language, errors)
    _check_tapl_counters(main, quest, errors)
    _check_tapl_reference_assets(main, prefix, errors)
    return errors

