@echo off
rem Starts the local MySQL server installed in %USERPROFILE%\mysql (leave this window open).
"%USERPROFILE%\mysql\mysql-8.4.9-winx64\bin\mysqld.exe" --defaults-file="%USERPROFILE%\mysql\my.ini" --console
