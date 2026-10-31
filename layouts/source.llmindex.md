{{- $base := strings.TrimSuffix "/" .Site.BaseURL -}}
{{- printf "# EmTalk public page index\n\n" -}}
{{- printf "Canonical build origin: %s/\n\n" $base -}}
{{- printf "Descriptions below come from the same metadata as the public HTML pages. Follow each page for its full content and context. This index contains no visitor answers, results, decisions, contact submissions or account data.\n\n" -}}
{{- printf "Self-assessments support reflection, not diagnosis. Decision Matrix AI is available in the Android app, not on this website. BRET has no AI features. TAPL is in development.\n\n" -}}
{{- range $route, $page := hugo.Data.seo.pages -}}
  {{- if $page.indexable -}}
    {{- printf "## %s\n\nURL: %s%s\n\n%s\n\n" $page.title $base $route $page.description -}}
  {{- end -}}
{{- end -}}
