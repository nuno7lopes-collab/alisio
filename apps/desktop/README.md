# Lume Desktop

Primeira shell Flutter da app pessoal.

Estado atual:

- UI nova, separada do `ui/` existente;
- login local mockado;
- arranque do worker local em modo de desenvolvimento;
- chat ligado à bridge local do worker;
- settings locais para a OpenAI API key.

Nota:

- nesta máquina o comando `flutter` não está instalado, por isso esta pasta contém a camada Dart/UI e os testes, mas não foi possível gerar aqui as shells nativas de `macos/` e `windows/`;
- quando o Flutter estiver disponível, corre `flutter create . --platforms=macos,windows` dentro desta pasta para gerar os wrappers nativos sem mexer na lógica já criada.
