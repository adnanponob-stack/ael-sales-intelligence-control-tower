s = open('Akij_Light_Engineering_Dashboard_Standalone.html', encoding='utf-8').read()
i = s.find('class="brand"')
print(s[i:i+260])
