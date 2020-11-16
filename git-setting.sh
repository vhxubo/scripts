#!/bin/bash
###
 # @Author: vhxubo
 # @Date: 2020-11-13 10:35:53
 # @LastEditTime: 2020-11-16 11:15:49
 # @LastEditors: vhxubo
 # @Description: 
### 

user_name="vhxubo"
user_email="vhxubo@gmail.com"

git config --global user.name $user_name
git config --global user.email $user_email

if [ ! -f ~/.ssh/id_rsa.pub ]; then
    ssh-keygen -t rsa -C $user_email
    cat ~/.ssh/id_rsa.pub
    echo -e "\nNow you can open https://github.com/settings/ssh/new and add the above key."
else
    ssh -T git@github.com
fi